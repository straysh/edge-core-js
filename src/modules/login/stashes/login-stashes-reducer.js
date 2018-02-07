// @flow

import { buildReducer } from 'redux-keto'

import type { RootAction } from '../../actions.js'
import type { LoginStash } from '../login-types.js'

export type LoginStashMap = { [username: string]: LoginStash }

export type LoginStashesState = {
  stashes: LoginStashMap,
  stashesLoaded: boolean
}

export default buildReducer({
  stashes (state: LoginStashMap = {}, action: RootAction): LoginStashMap {
    switch (action.type) {
      case 'LOGIN_DELETED': {
        const copy = { ...state }
        delete copy[action.payload]
        return copy
      }

      case 'LOGIN_STASHES_LOADED': {
        const out: LoginStashMap = {}

        // Extract the usernames from the top-level objects:
        for (const filename of Object.keys(action.payload)) {
          const json = action.payload[filename]
          if (json && json.username && json.loginId) {
            const { username } = json
            out[username] = json
          }
        }

        return out
      }

      case 'LOGIN_STASH_SAVED': {
        const { username } = action.payload
        if (!username) return state

        const out = { ...state }
        out[username] = action.payload
        return out
      }
    }
    return state
  },

  stashesLoaded (state = false, action: RootAction): boolean {
    return action.type === 'LOGIN_STASHES_LOADED' ? true : state
  }
})
