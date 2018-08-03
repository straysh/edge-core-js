// @flow

import { buildReducer, filterReducer, memoizeReducer } from 'redux-keto'

import type {
  EdgeBalances,
  EdgeCurrencyInfo,
  EdgeTransaction,
  EdgeWalletInfo
} from '../../../edge-core-index.js'
import type { RootAction } from '../../actions.js'
import type { RootState } from '../../root-reducer.js'
import { getCurrencyInfo } from '../currency-selectors.js'

/** Maps from txid hash to file creation date & path. */
export type TxFileNames = {
  [txidHash: string]: {
    creationDate: number,
    fileName: string
  }
}

/** Maps from txid hash to file contents (in JSON). */
export type TxFileJsons = { [txidHash: string]: Object }

/** Maps from txid hash to creation date. */
export type TxidHashes = { [txidHash: string]: number }

export type SortedTransactions = {
  sortedList: Array<string>,
  txidHashes: TxidHashes
}

export type MergedTransaction = {
  blockHeight: number,
  date: number,
  ourReceiveAddresses: Array<string>,
  signedTx: string,
  txid: string,

  nativeAmount: { [currencyCode: string]: string },
  networkFee: { [currencyCode: string]: string }
}

export interface CurrencyWalletState {
  currencyInfo: EdgeCurrencyInfo;
  displayPrivateSeed: string | null;
  displayPublicSeed: string | null;
  engineFailure: Error | null;
  fiat: string;
  fiatLoaded: boolean;
  files: TxFileJsons;
  fileNames: TxFileNames;
  fileNamesLoaded: boolean;
  sortedTransactions: SortedTransactions;
  balances: EdgeBalances;
  height: number;
  name: string | null;
  nameLoaded: boolean;
  walletInfo: EdgeWalletInfo;
  txids: Array<string>;
  txs: { [txid: string]: MergedTransaction };
}

export interface CurrencyWalletNext {
  id: string;
  root: RootState;
  +self: CurrencyWalletState;
}

const currencyWalletReducer = buildReducer({
  currencyInfo (state, action, next: CurrencyWalletNext): EdgeCurrencyInfo {
    if (state) return state
    return getCurrencyInfo(next.root.currency.infos, next.self.walletInfo.type)
  },

  displayPrivateSeed (state = null, action: RootAction): string | null {
    return action.type === 'CURRENCY_ENGINE_CHANGED_SEEDS'
      ? action.payload.displayPrivateSeed
      : state
  },

  displayPublicSeed (state = null, action: RootAction): string | null {
    return action.type === 'CURRENCY_ENGINE_CHANGED_SEEDS'
      ? action.payload.displayPublicSeed
      : state
  },

  engineFailure (state = null, action: RootAction) {
    return action.type === 'CURRENCY_ENGINE_FAILED' ? action.payload : state
  },

  fiat (state = '', action: RootAction) {
    return action.type === 'CURRENCY_WALLET_FIAT_CHANGED'
      ? action.payload.fiatCurrencyCode
      : state
  },

  fiatLoaded (state = false, action: RootAction) {
    return action.type === 'CURRENCY_WALLET_FIAT_CHANGED' ? true : state
  },

  files (state: TxFileJsons = {}, action: RootAction) {
    switch (action.type) {
      case 'CURRENCY_WALLET_FILE_CHANGED': {
        const { json, txidHash } = action.payload
        const out = { ...state }
        out[txidHash] = json
        return out
      }
      case 'CURRENCY_WALLET_FILES_LOADED': {
        const { files } = action.payload
        return {
          ...state,
          ...files
        }
      }
    }
    return state
  },

  sortedTransactions (
    state: SortedTransactions = { txidHashes: {}, sortedList: [] },
    action: RootAction,
    next: CurrencyWalletNext
  ) {
    const { txidHashes } = state
    switch (action.type) {
      case 'CURRENCY_ENGINE_CHANGED_TXS': {
        return sortTxs(txidHashes, action.payload.txidHashes)
      }
      case 'CURRENCY_WALLET_FILE_NAMES_LOADED': {
        const { txFileNames } = action.payload
        const newTxidHashes = {}
        Object.keys(txFileNames).map(txidHash => {
          newTxidHashes[txidHash] = txFileNames[txidHash].creationDate
        })
        return sortTxs(txidHashes, newTxidHashes)
      }
    }
    return state
  },

  fileNames (state: TxFileNames = {}, action: RootAction) {
    switch (action.type) {
      case 'CURRENCY_WALLET_FILE_NAMES_LOADED': {
        const { txFileNames } = action.payload
        return {
          ...state,
          ...txFileNames
        }
      }
      case 'CURRENCY_WALLET_FILE_CHANGED': {
        const { fileName, creationDate, txidHash } = action.payload
        if (!state[txidHash] || creationDate < state[txidHash].creationDate) {
          state[txidHash] = { creationDate, fileName }
        }
        return state
      }
    }
    return state
  },

  fileNamesLoaded (state = false, action: RootAction) {
    return action.type === 'CURRENCY_WALLET_FILE_NAMES_LOADED' ? true : state
  },

  balances (state = {}, action: RootAction): EdgeBalances {
    if (action.type === 'CURRENCY_ENGINE_CHANGED_BALANCE') {
      const out = { ...state }
      out[action.payload.currencyCode] = action.payload.balance
      return out
    }
    return state
  },

  height (state = 0, action: RootAction): number {
    return action.type === 'CURRENCY_ENGINE_CHANGED_HEIGHT'
      ? action.payload.height
      : state
  },

  name (state = null, action: RootAction) {
    return action.type === 'CURRENCY_WALLET_NAME_CHANGED'
      ? action.payload.name
      : state
  },

  nameLoaded (state = false, action: RootAction) {
    return action.type === 'CURRENCY_WALLET_NAME_CHANGED' ? true : state
  },

  txids: memoizeReducer(
    (next: CurrencyWalletNext) => next.self.txs,
    txs => Object.keys(txs)
  ),

  txs (state = {}, action: RootAction, next: CurrencyWalletNext) {
    switch (action.type) {
      case 'CURRENCY_ENGINE_CHANGED_TXS': {
        const { txs } = action.payload
        const defaultCurrency = next.self.currencyInfo.currencyCode
        const out = { ...state }
        for (const tx of txs) {
          out[tx.txid] = mergeTx(tx, defaultCurrency, out[tx.txid])
        }
        return out
      }
      case 'CURRENCY_ENGINE_CLEARED':
        return {}
    }

    return state
  },

  walletInfo (state, action, next: CurrencyWalletNext) {
    return next.root.login.walletInfos[next.id]
  }
})

export function sortTxs (txidHashes: TxidHashes, newHashes: TxidHashes) {
  for (const newTxidHash in newHashes) {
    const newTime = newHashes[newTxidHash]
    if (!txidHashes[newTxidHash] || newTime < txidHashes[newTxidHash]) {
      txidHashes[newTxidHash] = newTime
    }
  }
  const sortedList: Array<string> = Object.keys(txidHashes).sort(
    (txidHash1, txidHash2) => {
      if (txidHashes[txidHash1] > txidHashes[txidHash2]) return -1
      if (txidHashes[txidHash1] < txidHashes[txidHash2]) return 1
      return 0
    }
  )
  return { sortedList, txidHashes }
}

export default filterReducer(
  currencyWalletReducer,
  (action: RootAction, next: CurrencyWalletNext) => {
    return /^CURRENCY_/.test(action.type) && action.payload.walletId === next.id
      ? action
      : { type: 'UPDATE_PROPS' }
  }
)

const defaultTx: MergedTransaction = {
  blockHeight: 0,
  date: 0,
  ourReceiveAddresses: [],
  signedTx: '',
  txid: '',
  nativeAmount: {},
  networkFee: {},
  providerFee: {}
}

/**
 * Merges a new incoming transaction with an existing transaction.
 */
export function mergeTx (
  tx: EdgeTransaction,
  defaultCurrency: string,
  oldTx: MergedTransaction = defaultTx
): MergedTransaction {
  const out = {
    blockHeight: tx.blockHeight,
    date: tx.date,
    ourReceiveAddresses: tx.ourReceiveAddresses,
    signedTx: tx.signedTx,
    txid: tx.txid,

    nativeAmount: { ...oldTx.nativeAmount },
    networkFee: { ...oldTx.networkFee }
  }

  const currencyCode =
    tx.currencyCode != null ? tx.currencyCode : defaultCurrency
  out.nativeAmount[currencyCode] = tx.nativeAmount
  out.networkFee[currencyCode] =
    tx.networkFee != null ? tx.networkFee.toString() : '0'

  return out
}
