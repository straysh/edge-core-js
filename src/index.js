import {Context} from './context.js'
import {makeBrowserIo} from './io/browser'

/**
 * Initializes the Airbitz core library for use in a browser.
 * @return An Airbitz core library instance.
 */
export function makeBrowserContext (opts = {}) {
  return new Context(makeBrowserIo(opts), opts)
}

// Ancillary exports:
export * from './error.js'
export {makeRandomGenerator} from './crypto/crypto.js'

// Deprecated exports:
export {abcc as ABCConditionCode} from './ABCConditionCode.js'
export {ABCError} from './ABCError.js'
export {Context}
export {fixUsername as usernameFix} from './io/loginStore.js'
export {makeBrowserContext as makeABCContext}
export {makeBrowserContext as makeContext}
