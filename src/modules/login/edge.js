// @flow

import { Bridgeable, closeObject } from 'yaob'

import type {
  EdgeEdgeLoginRequest,
  EdgeLoginRequestEvents
} from '../../edge-core-index.js'
import { base58, base64 } from '../../util/encoding.js'
import { makeAccount } from '../account/account-api.js'
import type { ApiInput } from '../root.js'
import { makeLobby } from './lobby.js'
import type { LoginTree } from './login-types.js'
import { makeLoginTree, searchTree, syncLogin } from './login.js'

/**
 * The public API for edge login requests.
 */
class ABCEdgeLoginRequest extends Bridgeable<EdgeLoginRequestEvents>
  implements EdgeEdgeLoginRequest {
  _lobby: Object
  _subscription: Object

  constructor (ai: ApiInput, lobby: Object, appId: string) {
    super()
    this._lobby = lobby

    this._subscription = lobby.subscribe(
      reply => this._onReply(ai, reply, appId),
      e => this.emit('error', e)
    )
  }

  get id (): string {
    return this._lobby.lobbyId
  }

  cancelRequest () {
    this._subscription.unsubscribe()
    closeObject(this)
  }

  async _onReply (ai: ApiInput, reply, appId) {
    try {
      this._subscription.unsubscribe()
      const stashTree = reply.loginStash
      const { io, loginStore } = ai.props

      this.emit('processLogin', stashTree.username)

      // Find the appropriate child:
      const child = searchTree(stashTree, stash => stash.appId === appId)
      if (child == null) {
        throw new Error(`Cannot find requested appId: "${appId}"`)
      }

      // The Airbitz mobile will sometimes send the pin2Key in base58
      // instead of base64 due to an unfortunate bug. Fix that:
      if (child.pin2Key != null && child.pin2Key.slice(-1) !== '=') {
        io.console.warn('Fixing base58 pin2Key')
        child.pin2Key = base64.stringify(base58.parse(child.pin2Key))
      }
      loginStore.save(stashTree)

      // This is almost guaranteed to blow up spectacularly:
      const loginKey = base64.parse(reply.loginKey)
      const loginTree = makeLoginTree(stashTree, loginKey, appId)
      const login = searchTree(loginTree, login => login.appId === appId)
      if (login == null) {
        throw new Error(`Cannot find requested appId: "${appId}"`)
      }
      const newLoginTree: LoginTree = await syncLogin(ai, loginTree, login)
      const account = await makeAccount(ai, appId, newLoginTree, 'edgeLogin')

      this.emit('login', account)
    } catch (e) {
      this.emit('error', e)
    }
  }
}

/**
 * Creates a new account request lobby on the server.
 */
export function requestEdgeLogin (
  ai: ApiInput,
  appId: string,
  opts: { displayImageUrl: ?string, displayName: ?string }
) {
  const request = {
    loginRequest: {
      appId,
      displayImageUrl: opts.displayImageUrl,
      displayName: opts.displayName
    }
  }

  return makeLobby(ai, request).then(
    lobby => new ABCEdgeLoginRequest(ai, lobby, appId)
  )
}
