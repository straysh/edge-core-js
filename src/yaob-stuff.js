// @flow

import { Account, AccountSync } from './modules/account/account-api.js'
import { Context, ContextSync } from './modules/context/context-api-pixie.js'
import { CurrencyWalletSync } from './modules/currency/wallet/currency-wallet-api.js'

export { Account, Context }

export const sharedClasses = {
  AccountSync,
  ContextSync,
  CurrencyWalletSync
}
