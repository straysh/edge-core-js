// @flow

import { add, div, lte, mul, sub } from 'biggystring'
import { Proxyable } from 'yaob'

import type {
  DiskletFolder,
  EdgeBalances,
  EdgeCoinExchangeQuote,
  EdgeCurrencyCodeOptions,
  EdgeCurrencyEngine,
  EdgeCurrencyInfo,
  EdgeCurrencyPlugin,
  EdgeCurrencyWallet,
  EdgeCurrencyWalletEvents,
  EdgeDataDump,
  EdgeEncodeUri,
  EdgeGetTransactionsOptions,
  EdgeMetadata,
  EdgeParsedUri,
  EdgePaymentProtocolInfo,
  EdgeReceiveAddress,
  EdgeSpendInfo,
  EdgeSpendTarget,
  EdgeTokenInfo,
  EdgeTransaction,
  EdgeWalletInfo
} from '../../../edge-core-index.js'
import { SameCurrencyError } from '../../../error.js'
import { filterObject, mergeDeeply } from '../../../util/util.js'
import { makeShapeshiftApi } from '../../exchange/shapeshift.js'
import type { ShapeShiftExactQuoteReply } from '../../exchange/shapeshift.js'
import type { ApiInput } from '../../root.js'
import { ProxyableFolder } from '../../storage/proxyable-folder.js'
import { makeStorageWalletApi } from '../../storage/storage-api.js'
import { getCurrencyMultiplier } from '../currency-selectors.js'
import {
  exportTransactionsToCSVInner,
  exportTransactionsToQBOInner
} from './currency-wallet-export.js'
import {
  loadTxFiles,
  renameCurrencyWallet,
  setCurrencyWalletFiat,
  setCurrencyWalletTxMetadata
} from './currency-wallet-files.js'
import type { TransactionFile } from './currency-wallet-files.js'
import type { CurrencyWalletInput } from './currency-wallet-pixie.js'
import type { MergedTransaction } from './currency-wallet-reducer.js'

const fakeMetadata = {
  bizId: 0,
  category: '',
  exchangeAmount: {},
  name: '',
  notes: ''
}

export class CurrencyWalletSync extends Proxyable<EdgeCurrencyWalletEvents> {
  +balances: EdgeBalances
  +blockHeight: number
  +currencyInfo: EdgeCurrencyInfo
  +displayPrivateSeed: string | null
  +displayPublicSeed: string | null

  getBalance (opts: EdgeCurrencyCodeOptions = {}) {
    return this.balances[opts.currencyCode || this.currencyInfo.currencyCode]
  }

  getBlockHeight () {
    return this.blockHeight
  }

  getDisplayPrivateSeed (): string | null {
    return this.displayPrivateSeed
  }

  getDisplayPublicSeed (): string | null {
    return this.displayPublicSeed
  }
}

export class CurrencyWallet extends CurrencyWalletSync
  implements EdgeCurrencyWallet {
  +_input: CurrencyWalletInput
  +_plugin: EdgeCurrencyPlugin
  +_engine: EdgeCurrencyEngine
  +_ai: ApiInput
  +_walletInfo: EdgeWalletInfo
  +_shapeshiftApi: *
  +_storageWalletApi: *
  +_folder: ProxyableFolder
  +_localFolder: ProxyableFolder

  constructor (
    input: CurrencyWalletInput,
    plugin: EdgeCurrencyPlugin,
    engine: EdgeCurrencyEngine
  ) {
    super()

    this._input = input
    this._plugin = plugin
    this._engine = engine
    const ai: any = input // Safe, since input extends ApiInput
    this._ai = ai
    this._walletInfo = input.props.selfState.walletInfo
    this._shapeshiftApi = makeShapeshiftApi(ai)
    this._storageWalletApi = makeStorageWalletApi(ai, this._walletInfo, {})

    this._folder = new ProxyableFolder(this._storageWalletApi.folder)
    this._localFolder = new ProxyableFolder(this._storageWalletApi.localFolder)
  }

  // Storage wallet properties:
  get id (): string {
    return this._storageWalletApi.id
  }
  get type (): string {
    return this._storageWalletApi.type
  }
  get keys (): Object {
    return this._storageWalletApi.keys
  }
  get folder (): DiskletFolder {
    return this._folder
  }
  get localFolder (): DiskletFolder {
    return this._localFolder
  }
  get displayPrivateSeed (): string | null {
    return this._input.props.selfState.displayPrivateSeed
  }
  get displayPublicSeed (): string | null {
    return this._input.props.selfState.displayPublicSeed
  }
  sync () {
    return this._storageWalletApi.sync()
  }

  // Storage stuff:
  get name (): string | null {
    return this._input.props.selfState.name
  }
  renameWallet (name: string) {
    return renameCurrencyWallet(this._input, name).then(() => {})
  }

  // Currency info:
  get fiatCurrencyCode (): string {
    return this._input.props.selfState.fiat
  }
  get currencyInfo (): EdgeCurrencyInfo {
    return this._plugin.currencyInfo
  }
  setFiatCurrencyCode (fiatCurrencyCode: string) {
    return setCurrencyWalletFiat(this._input, fiatCurrencyCode).then(() => {})
  }

  // Chain state:
  get balances (): EdgeBalances {
    return this._input.props.selfState.balances
  }

  get blockHeight (): number {
    return this._input.props.selfState.height
  }

  // Running state:
  startEngine () {
    return this._engine.startEngine()
  }

  stopEngine (): Promise<mixed> {
    return Promise.resolve(this._engine.killEngine())
  }

  enableTokens (tokens: Array<string>) {
    return this._engine.enableTokens(tokens)
  }

  disableTokens (tokens: Array<string>) {
    return this._engine.disableTokens(tokens)
  }

  getEnabledTokens () {
    return this._engine.getEnabledTokens()
  }

  addCustomToken (tokenInfo: EdgeTokenInfo) {
    this._ai.props.dispatch({ type: 'ADDED_CUSTOM_TOKEN', payload: tokenInfo })
    return this._engine.addCustomToken(tokenInfo)
  }

  // Transactions:
  getNumTransactions (opts: EdgeCurrencyCodeOptions = {}): Promise<number> {
    return Promise.resolve(this._engine.getNumTransactions(opts))
  }

  async getTransactions (
    opts: EdgeGetTransactionsOptions = {}
  ): Promise<Array<EdgeTransaction>> {
    const defaultCurrency = this._plugin.currencyInfo.currencyCode
    const currencyCode = opts.currencyCode || defaultCurrency
    const state = this._input.props.selfState
    // Txid array of all txs
    const txids = state.txids
    // Merged tx data from metadata files and blockchain data
    const txs = state.txs
    const { startIndex = 0, startEntries = txids.length } = opts
    // Decrypted metadata files
    const files = state.files
    // A sorted list of transaction based on chronological order
    const sortedTransactions = state.sortedTransactions.sortedList
    // Quick fix for Tokens
    const allInfos = this._input.props.state.currency.infos
    let slice = false
    for (const currencyInfo of allInfos) {
      if (currencyCode === currencyInfo.currencyCode) {
        slice = true
        break
      }
    }
    const slicedTransactions = slice
      ? sortedTransactions.slice(startIndex, startIndex + startEntries)
      : sortedTransactions
    const missingTxIdHashes = slicedTransactions.filter(
      txidHash => !files[txidHash]
    )
    const missingFiles = await loadTxFiles(this._input, missingTxIdHashes)
    Object.assign(files, missingFiles)

    const out: Array<EdgeTransaction> = []
    for (const txidHash of slicedTransactions) {
      const file = files[txidHash]
      const tx = txs[file.txid]
      // Skip irrelevant transactions:
      if (
        !tx ||
        (!tx.nativeAmount[currencyCode] && !tx.networkFee[currencyCode])
      ) {
        continue
      }

      out.push(combineTxWithFile(this._input, tx, file, currencyCode))
    }

    return out
  }

  async exportTransactionsToQBO (
    opts: EdgeGetTransactionsOptions
  ): Promise<string> {
    const edgeTransactions: Array<EdgeTransaction> = await this.getTransactions(
      opts
    )
    const currencyCode =
      opts && opts.currencyCode
        ? opts.currencyCode
        : this._input.props.selfState.currencyInfo.currencyCode
    const denom = opts && opts.denomination ? opts.denomination : null
    const qbo: string = exportTransactionsToQBOInner(
      edgeTransactions,
      currencyCode,
      this.fiatCurrencyCode,
      denom,
      Date.now()
    )
    return qbo
  }

  async exportTransactionsToCSV (
    opts: EdgeGetTransactionsOptions
  ): Promise<string> {
    const edgeTransactions: Array<EdgeTransaction> = await this.getTransactions(
      opts
    )
    const currencyCode =
      opts && opts.currencyCode
        ? opts.currencyCode
        : this._input.props.selfState.currencyInfo.currencyCode
    const denom = opts && opts.denomination ? opts.denomination : null
    const csv: string = await exportTransactionsToCSVInner(
      edgeTransactions,
      currencyCode,
      this.fiatCurrencyCode,
      denom
    )
    return csv
  }

  getReceiveAddress (
    opts: EdgeCurrencyCodeOptions = {}
  ): Promise<EdgeReceiveAddress> {
    const freshAddress = this._engine.getFreshAddress(opts)
    const receiveAddress: EdgeReceiveAddress = {
      metadata: fakeMetadata,
      nativeAmount: '0',
      publicAddress: freshAddress.publicAddress,
      legacyAddress: freshAddress.legacyAddress,
      segwitAddress: freshAddress.segwitAddress
    }
    return Promise.resolve(receiveAddress)
  }

  saveReceiveAddress (receiveAddress: EdgeReceiveAddress): Promise<mixed> {
    return Promise.resolve()
  }

  lockReceiveAddress (receiveAddress: EdgeReceiveAddress): Promise<mixed> {
    return Promise.resolve()
  }

  async makeSpend (spendInfo: EdgeSpendInfo): Promise<EdgeTransaction> {
    return this._engine.makeSpend(spendInfo)
  }

  async sweepPrivateKeys (spendInfo: EdgeSpendInfo): Promise<EdgeTransaction> {
    if (!this._engine.sweepPrivateKeys) {
      return Promise.reject(
        new Error('Sweeping this currency is not supported.')
      )
    }
    return this._engine.sweepPrivateKeys(spendInfo)
  }

  async getQuote (spendInfo: EdgeSpendInfo): Promise<EdgeCoinExchangeQuote> {
    const destWallet = spendInfo.spendTargets[0].destWallet
    if (!destWallet) {
      throw new SameCurrencyError()
    }
    const currentCurrencyCode = spendInfo.currencyCode
      ? spendInfo.currencyCode
      : this._plugin.currencyInfo.currencyCode
    const destCurrencyCode = spendInfo.spendTargets[0].currencyCode
      ? spendInfo.spendTargets[0].currencyCode
      : destWallet.currencyInfo.currencyCode
    if (destCurrencyCode === currentCurrencyCode) {
      throw new SameCurrencyError()
    }
    const edgeFreshAddress = this._engine.getFreshAddress({
      currencyCode: destCurrencyCode
    })
    const edgeReceiveAddress = await destWallet.getReceiveAddress()

    let destPublicAddress
    if (edgeReceiveAddress.legacyAddress) {
      destPublicAddress = edgeReceiveAddress.legacyAddress
    } else {
      destPublicAddress = edgeReceiveAddress.publicAddress
    }

    let currentPublicAddress
    if (edgeFreshAddress.legacyAddress) {
      currentPublicAddress = edgeFreshAddress.legacyAddress
    } else {
      currentPublicAddress = edgeFreshAddress.publicAddress
    }

    const nativeAmount = spendInfo.nativeAmount
    const quoteFor = spendInfo.quoteFor
    if (!quoteFor) {
      throw new Error('Need to define direction for quoteFor')
    }
    const destAmount = spendInfo.spendTargets[0].nativeAmount
    /* console.log('core: destAmount', destAmount) */
    // here we are going to get multipliers
    const currencyInfos = this._ai.props.state.currency.infos
    const tokenInfos = this._ai.props.state.currency.customTokens
    const multiplierFrom = getCurrencyMultiplier(
      currencyInfos,
      tokenInfos,
      currentCurrencyCode
    )
    const multiplierTo = getCurrencyMultiplier(
      currencyInfos,
      tokenInfos,
      destCurrencyCode
    )

    /* if (destAmount) {
          nativeAmount = destAmount
        } */
    if (!nativeAmount) {
      throw new Error('Need to define a native amount')
    }
    const nativeAmountForQuote = destAmount || nativeAmount

    const quoteData: ShapeShiftExactQuoteReply = await this._shapeshiftApi.getexactQuote(
      currentCurrencyCode,
      destCurrencyCode,
      currentPublicAddress,
      destPublicAddress,
      nativeAmountForQuote,
      quoteFor,
      multiplierFrom,
      multiplierTo
    )
    if (!quoteData.success) {
      throw new Error('Did not get back successful quote')
    }
    const exchangeData = quoteData.success
    const nativeAmountForSpend = destAmount
      ? mul(exchangeData.depositAmount, multiplierFrom)
      : nativeAmount

    const hasDestTag = exchangeData.deposit.indexOf('?dt=') !== -1
    let destTag
    if (hasDestTag) {
      const splitArray = exchangeData.deposit.split('?dt=')
      exchangeData.deposit = splitArray[0]
      destTag = splitArray[1]
    }

    const spendTarget: EdgeSpendTarget = {
      nativeAmount: nativeAmountForSpend,
      publicAddress: exchangeData.deposit
    }
    if (hasDestTag) {
      spendTarget.otherParams = {
        uniqueIdentifier: destTag
      }
    }
    if (currentCurrencyCode === 'XMR' && exchangeData.sAddress) {
      const paymentId = exchangeData.deposit
      spendTarget.publicAddress = exchangeData.sAddress
      spendTarget.otherParams = {
        uniqueIdentifier: paymentId
      }
    }

    const exchangeSpendInfo: EdgeSpendInfo = {
      // networkFeeOption: spendInfo.networkFeeOption,
      currencyCode: spendInfo.currencyCode,
      spendTargets: [spendTarget]
    }
    const tx = await this._engine.makeSpend(exchangeSpendInfo)
    tx.otherParams = tx.otherParams || {}
    tx.otherParams.exchangeData = exchangeData
    const edgeCoinExchangeQuote: EdgeCoinExchangeQuote = {
      depositAmountNative: mul(exchangeData.depositAmount, multiplierFrom),
      withdrawalAmountNative: mul(exchangeData.withdrawalAmount, multiplierTo),
      expiration: exchangeData.expiration,
      quotedRate: exchangeData.quotedRate,
      maxLimit: exchangeData.maxLimit,
      orderId: exchangeData.orderId,
      edgeTransacton: tx
    }
    return edgeCoinExchangeQuote
  }

  signTx (tx: EdgeTransaction): Promise<EdgeTransaction> {
    return this._engine.signTx(tx)
  }

  broadcastTx (tx: EdgeTransaction): Promise<EdgeTransaction> {
    return this._engine.broadcastTx(tx)
  }

  saveTx (tx: EdgeTransaction) {
    return this._engine.saveTx(tx)
  }

  resyncBlockchain (): Promise<mixed> {
    this._ai.props.dispatch({
      type: 'CURRENCY_ENGINE_CLEARED',
      payload: { walletId: this._input.props.id }
    })
    return Promise.resolve(this._engine.resyncBlockchain())
  }

  dumpData (): Promise<EdgeDataDump> {
    return Promise.resolve(this._engine.dumpData())
  }

  getPaymentProtocolInfo (
    paymentProtocolUrl: string
  ): Promise<EdgePaymentProtocolInfo> {
    if (!this._engine.getPaymentProtocolInfo) {
      throw new Error(
        "'getPaymentProtocolInfo' is not implemented on wallets of this type"
      )
    }
    return this._engine.getPaymentProtocolInfo(paymentProtocolUrl)
  }

  saveTxMetadata (txid: string, currencyCode: string, metadata: EdgeMetadata) {
    return setCurrencyWalletTxMetadata(
      this._input,
      txid,
      currencyCode,
      fixMetadata(metadata, this._input.props.selfState.fiat)
    )
  }

  getMaxSpendable (spendInfo: EdgeSpendInfo): Promise<string> {
    const { currencyCode, networkFeeOption, customNetworkFee } = spendInfo
    const balance = this._engine.getBalance({ currencyCode })

    // Copy all the spend targets, setting the amounts to 0
    // but keeping all other information so we can get accurate fees:
    const spendTargets = spendInfo.spendTargets.map(spendTarget => {
      if (
        spendTarget.currencyCode &&
        spendTarget.currencyCode !== currencyCode
      ) {
        throw new Error('Cannot to a cross-currency max-spend')
      }
      return { ...spendTarget, nativeAmount: '0' }
    })

    // The range of possible values includes `min`, but not `max`.
    const getMax = (min: string, max: string): Promise<string> => {
      const diff = sub(max, min)
      if (lte(diff, '1')) {
        return Promise.resolve(min)
      }
      const mid = add(min, div(diff, '2'))

      // Try the average:
      spendTargets[0].nativeAmount = mid
      return this._engine
        .makeSpend({
          currencyCode,
          spendTargets,
          networkFeeOption,
          customNetworkFee
        })
        .then(good => getMax(mid, max))
        .catch(bad => getMax(min, mid))
    }

    return getMax('0', add(balance, '1'))
  }

  parseUri (uri: string): Promise<EdgeParsedUri> {
    return Promise.resolve(this._plugin.parseUri(uri))
  }

  encodeUri (obj: EdgeEncodeUri): Promise<string> {
    return Promise.resolve(this._plugin.encodeUri(obj))
  }
}

/**
 * Creates an `EdgeCurrencyWallet` API object.
 */
export function makeCurrencyWalletApi (
  input: CurrencyWalletInput,
  plugin: EdgeCurrencyPlugin,
  engine: EdgeCurrencyEngine
) {
  return new CurrencyWallet(input, plugin, engine)
}

function fixMetadata (metadata: EdgeMetadata, fiat: string) {
  const out = filterObject(metadata, [
    'bizId',
    'category',
    'exchangeAmount',
    'name',
    'notes'
  ])

  if (metadata.amountFiat != null) {
    if (out.exchangeAmount == null) out.exchangeAmount = {}
    out.exchangeAmount[fiat] = metadata.amountFiat
  }

  return out
}

export function combineTxWithFile (
  input: CurrencyWalletInput,
  tx: MergedTransaction,
  file: TransactionFile,
  currencyCode: string
): EdgeTransaction {
  const wallet = input.props.selfOutput.api
  const walletCurrency = input.props.selfState.currencyInfo.currencyCode
  const walletFiat = input.props.selfState.fiat

  // Copy the tx properties to the output:
  const out: EdgeTransaction = {
    blockHeight: tx.blockHeight,
    date: tx.date,
    ourReceiveAddresses: tx.ourReceiveAddresses,
    signedTx: tx.signedTx,
    txid: tx.txid,

    amountSatoshi: Number(tx.nativeAmount[currencyCode]),
    nativeAmount: tx.nativeAmount[currencyCode],
    networkFee: tx.networkFee[currencyCode],
    currencyCode,
    wallet,

    otherParams: {}
  }

  // These are our fallback values:
  const fallback = {
    providerFeeSent: 0,
    metadata: {
      name: '',
      category: '',
      notes: '',
      bizId: 0,
      amountFiat: 0,
      exchangeAmount: {}
    }
  }

  const merged = file
    ? mergeDeeply(
      fallback,
      file.currencies[walletCurrency],
      file.currencies[currencyCode]
    )
    : fallback

  if (file && file.creationDate < out.date) out.date = file.creationDate
  out.metadata = merged.metadata
  if (
    merged.metadata &&
    merged.metadata.exchangeAmount &&
    merged.metadata.exchangeAmount[walletFiat]
  ) {
    out.metadata.amountFiat = merged.metadata.exchangeAmount[walletFiat]
    if (out.metadata && out.metadata.amountFiat.toString().includes('e')) {
      // Corrupt amountFiat that exceeds a number that JS can cleanly represent without exponents. Set to 0
      out.metadata.amountFiat = 0
    }
  } else {
    console.info('Missing amountFiat in combineTxWithFile')
  }

  return out
}
