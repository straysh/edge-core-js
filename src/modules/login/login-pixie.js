// @flow

import { combinePixies } from 'redux-pixies'

import stashes from './stashes/login-stashes-pixie.js'

export type LoginOutput = {}

export default combinePixies({
  stashes
})
