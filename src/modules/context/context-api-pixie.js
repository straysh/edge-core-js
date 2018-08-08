// @flow

import { stopUpdates } from 'redux-pixies'
import { Bridgeable } from 'yaob'

import type {
  EdgeAccountOptions,
  EdgeContext,
  EdgeContextEvents,
  EdgeEdgeLoginOptions,
  EdgeExchangeSwapInfo,
  EdgeLoginMessages
} from '../../edge-core-index.js'
import { base58 } from '../../util/encoding.js'
import { makeAccount } from '../account/account-api.js'
import { makeShapeshiftApi } from '../exchange/shapeshift.js'
import { createLogin, usernameAvailable } from '../login/create.js'
import { requestEdgeLogin } from '../login/edge.js'
import { fetchLoginMessages, makeLoginTree, resetOtp } from '../login/login.js'
import { fixUsername } from '../login/loginStore.js'
import { checkPasswordRules, loginPassword } from '../login/password.js'
import { getPin2Key, loginPin2 } from '../login/pin2.js'
import {
  getQuestions2,
  getRecovery2Key,
  listRecoveryQuestionChoices,
  loginRecovery2
} from '../login/recovery2.js'
import type { ApiInput } from '../root.js'
import { EdgeInternalStuff } from './internal-api.js'

/**
 * Synchronous client-side context methods.
 */
export class ContextSync extends Bridgeable<EdgeContextEvents> {
  checkPasswordRules (password: string) {
    return checkPasswordRules(password)
  }

  fixUsername (username: string): string {
    return fixUsername(username)
  }
}

/**
 * Asynchronous server-side context methods.
 */
export class Context extends ContextSync implements EdgeContext {
  +_ai: ApiInput
  +_internalApi: EdgeInternalStuff
  +_shapeshiftApi: *

  constructor (ai: ApiInput) {
    super()
    this._ai = ai
    this._internalApi = new EdgeInternalStuff(ai)
    this._shapeshiftApi = makeShapeshiftApi(ai)
  }

  get appId (): string {
    return this._ai.props.state.login.appId
  }

  get _internalEdgeStuff (): EdgeInternalStuff {
    return this._internalApi
  }

  listUsernames (): Promise<Array<string>> {
    const { loginStore } = this._ai.props

    return loginStore.listUsernames()
  }

  deleteLocalAccount (username: string): Promise<mixed> {
    const { loginStore } = this._ai.props

    return loginStore.remove(username)
  }

  usernameAvailable (username: string): Promise<boolean> {
    return usernameAvailable(this._ai, username)
  }

  createAccount (
    username: string,
    password?: string,
    pin?: string,
    opts?: EdgeAccountOptions
  ) {
    const { appId } = this._ai.props.state.login
    const { callbacks } = opts || {} // opts can be `null`

    return createLogin(this._ai, username, {
      password,
      pin
    }).then(loginTree => {
      return makeAccount(this._ai, appId, loginTree, 'newAccount', callbacks)
    })
  }

  loginWithKey (username: string, loginKey: string, opts?: EdgeAccountOptions) {
    const { appId } = this._ai.props.state.login
    const { loginStore } = this._ai.props
    const { callbacks } = opts || {} // opts can be `null`

    return loginStore.load(username).then(stashTree => {
      const loginTree = makeLoginTree(stashTree, base58.parse(loginKey), appId)
      return makeAccount(this._ai, appId, loginTree, 'keyLogin', callbacks)
    })
  }

  loginWithPassword (
    username: string,
    password: string,
    opts?: EdgeAccountOptions
  ) {
    const { appId } = this._ai.props.state.login
    const { callbacks, otp } = opts || {} // opts can be `null`

    return loginPassword(this._ai, username, password, otp).then(loginTree => {
      return makeAccount(this._ai, appId, loginTree, 'passwordLogin', callbacks)
    })
  }

  async pinExists (username: string) {
    const { appId } = this._ai.props.state.login
    const { loginStore } = this._ai.props

    const loginStash = await loginStore.load(username)
    const pin2Key = getPin2Key(loginStash, appId)
    return pin2Key && pin2Key.pin2Key != null
  }

  pinLoginEnabled (username: string) {
    return this.pinExists(username)
  }

  loginWithPIN (username: string, pin: string, opts?: EdgeAccountOptions) {
    const { appId } = this._ai.props.state.login
    const { callbacks, otp } = opts || {} // opts can be `null`

    return loginPin2(this._ai, appId, username, pin, otp).then(loginTree => {
      return makeAccount(this._ai, appId, loginTree, 'pinLogin', callbacks)
    })
  }

  getRecovery2Key (username: string) {
    const { loginStore } = this._ai.props

    return loginStore.load(username).then(loginStash => {
      const recovery2Key = getRecovery2Key(loginStash)
      if (recovery2Key == null) {
        throw new Error('No recovery key stored locally.')
      }
      return base58.stringify(recovery2Key)
    })
  }

  loginWithRecovery2 (
    recovery2Key: string,
    username: string,
    answers: Array<string>,
    opts?: EdgeAccountOptions
  ) {
    const { appId } = this._ai.props.state.login
    const { callbacks, otp } = opts || {} // opts can be `null`

    return loginRecovery2(
      this._ai,
      base58.parse(recovery2Key),
      username,
      answers,
      otp
    ).then(loginTree => {
      return makeAccount(this._ai, appId, loginTree, 'recoveryLogin', callbacks)
    })
  }

  fetchRecovery2Questions (recovery2Key: string, username: string) {
    return getQuestions2(this._ai, base58.parse(recovery2Key), username)
  }

  listRecoveryQuestionChoices () {
    return listRecoveryQuestionChoices(this._ai)
  }

  requestEdgeLogin (opts: EdgeEdgeLoginOptions) {
    const { appId } = this._ai.props.state.login
    const { displayImageUrl, displayName } = opts

    return requestEdgeLogin(this._ai, appId, { displayImageUrl, displayName })
  }

  requestOtpReset (username: string, otpResetToken: string): Promise<Date> {
    return resetOtp(this._ai, username, otpResetToken)
  }

  fetchLoginMessages (): Promise<EdgeLoginMessages> {
    return fetchLoginMessages(this._ai)
  }

  getExchangeSwapRate (
    fromCurrencyCode: string,
    toCurrencyCode: string
  ): Promise<number> {
    return this._shapeshiftApi.getExchangeSwapRate(
      fromCurrencyCode,
      toCurrencyCode
    )
  }

  getAvailableExchangeTokens (): Promise<Array<string>> {
    return this._shapeshiftApi.getAvailableExchangeTokens()
  }

  getExchangeSwapInfo (
    fromCurrencyCode: string,
    toCurrencyCode: string
  ): Promise<EdgeExchangeSwapInfo> {
    return this._shapeshiftApi.getExchangeSwapInfo(
      fromCurrencyCode,
      toCurrencyCode
    )
  }
}

export const contextApiPixie = (ai: ApiInput) => () => {
  ai.onOutput(new Context(ai))
  return stopUpdates
}
