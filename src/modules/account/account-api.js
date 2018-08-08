// @flow

import { Bridgeable } from 'yaob'

import type {
  DiskletFolder,
  EdgeAccount,
  EdgeAccountCallbacks,
  EdgeAccountEvents,
  EdgeCreateCurrencyWalletOptions,
  EdgeCurrencyToolsMap,
  EdgeCurrencyWallet,
  EdgeLobby,
  EdgePluginData,
  EdgeWalletInfo,
  EdgeWalletInfoFull,
  EdgeWalletStates
} from '../../edge-core-index.js'
import { base58 } from '../../util/encoding.js'
import { getCurrencyPlugin } from '../currency/currency-selectors.js'
import { makeExchangeCache } from '../exchange/exchange-api.js'
import { findFirstKey, makeKeysKit, makeStorageKeyInfo } from '../login/keys.js'
import type { LoginTree } from '../login/login-types.js'
import { checkPassword } from '../login/password.js'
import { checkPin2 } from '../login/pin2.js'
import type { ApiInput } from '../root.js'
import { ProxyableFolder } from '../storage/proxyable-folder.js'
import {
  getStorageWalletFolder,
  getStorageWalletLocalFolder
} from '../storage/storage-selectors.js'
import { AccountState, makeAccountState } from './account-state.js'
import { makeLobbyApi } from './lobby-api.js'
import { PluginData } from './plugin-data-api.js'

/**
 * Synchronous client-side account methods.
 */
export class AccountSync extends Bridgeable<EdgeAccountEvents> {
  +allKeys: Array<EdgeWalletInfoFull>

  getFirstWalletInfo (type: string): ?EdgeWalletInfo {
    const allKeys: any = this.allKeys // WalletInfoFull -> WalletInfo
    return findFirstKey(allKeys, type)
  }

  getWalletInfo (id: string): ?EdgeWalletInfo {
    const allKeys: any = this.allKeys // WalletInfoFull -> WalletInfo
    return allKeys.find(info => info.id === id)
  }

  listWalletIds (): Array<string> {
    return this.allKeys.map(info => info.id)
  }
}

/**
 * Asynchronous server-side account methods.
 */
export class Account extends AccountSync implements EdgeAccount {
  _ai: ApiInput
  _exchangeCache: *
  _folder: ProxyableFolder
  _localFolder: ProxyableFolder
  _loginType: string
  _pluginData: *
  _state: AccountState

  setup (ai: ApiInput, state: AccountState, loginType: string) {
    this._ai = ai
    this._state = state
    this._loginType = loginType
    this._exchangeCache = makeExchangeCache(ai)
    this._pluginData = new PluginData(ai, state.accountWalletInfo)
    this._folder = new ProxyableFolder(
      getStorageWalletFolder(ai.props.state, state.accountWalletInfo.id)
    )
    this._localFolder = new ProxyableFolder(
      getStorageWalletLocalFolder(ai.props.state, state.accountWalletInfo.id)
    )
    return this
  }

  // Basic login information:
  get appId (): string {
    return this._state.login.appId
  }
  get loggedIn (): boolean {
    return this._state.loginTree != null
  }
  get loginKey (): string {
    return base58.stringify(this._state.login.loginKey)
  }
  get recoveryKey (): string | void {
    return this._state.login.recovery2Key != null
      ? base58.stringify(this._state.login.recovery2Key)
      : void 0
  }
  get username (): string {
    if (!this._state.loginTree.username) throw new Error('Missing username')
    return this._state.loginTree.username
  }

  // Speciality API's:
  get currencyTools (): EdgeCurrencyToolsMap {
    return this._state.currencyTools
  }
  get exchangeCache (): any {
    return this._exchangeCache
  }
  get folder (): DiskletFolder {
    return this._folder
  }
  get localFolder (): DiskletFolder {
    return this._localFolder
  }
  get pluginData (): EdgePluginData {
    return this._pluginData
  }

  // What login method was used?
  get edgeLogin (): boolean {
    return this._state.loginTree.loginKey == null
  }
  get keyLogin (): boolean {
    return this._loginType === 'keyLogin'
  }
  get newAccount (): boolean {
    return this._loginType === 'newAccount'
  }
  get passwordLogin (): boolean {
    return this._loginType === 'passwordLogin'
  }
  get pinLogin (): boolean {
    return this._loginType === 'pinLogin'
  }
  get recoveryLogin (): boolean {
    return this._loginType === 'recoveryLogin'
  }

  // Change or create credentials:
  changePassword (password: string): Promise<mixed> {
    return this._state.changePassword(password).then(() => {})
  }
  changePin (opts: {
    pin?: string, // We keep the existing PIN if unspecified
    enableLogin?: boolean // We default to true if unspecified
  }): Promise<string> {
    const { pin, enableLogin } = opts
    return this._state.changePin(pin, enableLogin).then(() => {
      return this._state.login.pin2Key
        ? base58.stringify(this._state.login.pin2Key)
        : ''
    })
  }
  changeRecovery (
    questions: Array<string>,
    answers: Array<string>
  ): Promise<string> {
    return this._state.changeRecovery(questions, answers).then(() => {
      this.update()
      if (!this._state.loginTree.recovery2Key) {
        throw new Error('Missing recoveryKey')
      }
      return base58.stringify(this._state.loginTree.recovery2Key)
    })
  }

  // Verify existing credentials:
  checkPassword (password: string): Promise<boolean> {
    return checkPassword(this._ai, this._state.loginTree, password)
  }
  checkPin (pin: string): Promise<boolean> {
    // Try to check the PIN locally, then fall back on the server:
    return this._state.login.pin != null
      ? Promise.resolve(pin === this._state.login.pin)
      : checkPin2(this._ai, this._state.loginTree, pin)
  }

  // Remove credentials:
  deletePassword (): Promise<mixed> {
    return this._state.deletePassword().then(() => {})
  }
  deletePin (): Promise<mixed> {
    return this._state.deletePin().then(() => {})
  }
  deleteRecovery (): Promise<mixed> {
    return this._state.deleteRecovery().then(() => {
      this.update()
    })
  }

  // OTP:
  get otpKey (): string | void {
    return this._state.login.otpTimeout != null
      ? this._state.login.otpKey
      : void 0
  }
  get otpResetDate (): string | void {
    return this._state.login.otpResetDate
  }
  cancelOtpReset (): Promise<mixed> {
    return this._state.cancelOtpReset().then(() => {
      this.update()
    })
  }
  enableOtp (timeout: number = 7 * 24 * 60 * 60): Promise<mixed> {
    return this._state.enableOtp(timeout).then(() => {
      this.update()
    })
  }
  disableOtp (): Promise<mixed> {
    return this._state.disableOtp().then(() => {
      this.update()
    })
  }

  // Edge login approval:
  fetchLobby (lobbyId: string): Promise<EdgeLobby> {
    return makeLobbyApi(this._ai, lobbyId, this._state)
  }

  // Login management:
  logout (): Promise<mixed> {
    return this._state.logout()
  }

  // Master wallet list:
  get allKeys (): Array<EdgeWalletInfoFull> {
    return this._state.allKeys
  }
  changeWalletStates (walletStates: EdgeWalletStates): Promise<mixed> {
    return this._state.changeWalletStates(walletStates).then(() => {
      this.update()
    })
  }
  createWallet (type: string, keys: any): Promise<string> {
    if (keys == null) {
      // Use the currency plugin to create the keys:
      const plugin = getCurrencyPlugin(
        this._ai.props.output.currency.plugins,
        type
      )
      keys = plugin.createPrivateKey(type)
    }

    const walletInfo = makeStorageKeyInfo(this._ai, type, keys)
    const kit = makeKeysKit(this._ai, this._state.login, walletInfo)
    return this._state.applyKit(kit).then(() => {
      this.update()
      return walletInfo.id
    })
  }
  splitWalletInfo (walletId: string, newWalletType: string): Promise<string> {
    return this._state.splitWalletInfo(walletId, newWalletType).then(id => {
      this.update()
      return id
    })
  }
  listSplittableWalletTypes (walletId: string): Promise<Array<string>> {
    return this._state.listSplittableWalletTypes(walletId)
  }

  // Currency wallets:
  get activeWalletIds (): Array<string> {
    return this._ai.props.state.login.logins[this._state.activeLoginId]
      .activeWalletIds
  }
  get archivedWalletIds (): Array<string> {
    return this._ai.props.state.login.logins[this._state.activeLoginId]
      .archivedWalletIds
  }
  get currencyWallets (): { [walletId: string]: EdgeCurrencyWallet } {
    const allIds = this._ai.props.state.currency.currencyWalletIds
    const allLogins = this._ai.props.state.login.logins
    const selfState = allLogins[this._state.activeLoginId]
    const myIds = allIds.filter(id => id in selfState.allWalletInfos)

    const out = {}
    for (const walletId of myIds) {
      const api = this._ai.props.output.currency.wallets[walletId].api
      if (api) out[walletId] = api
    }

    return out
  }
  async createCurrencyWallet (
    type: string,
    opts?: EdgeCreateCurrencyWalletOptions = {}
  ): Promise<EdgeCurrencyWallet> {
    const wallet = await this._state.createCurrencyWallet(type, opts)
    this.update()
    return wallet
  }
}

export let theApi: Account | null = null

/**
 * Creates an `Account` API object.
 */
export function makeAccount (
  ai: ApiInput,
  appId: string,
  loginTree: LoginTree,
  loginType: string = '',
  callbacks: EdgeAccountCallbacks = {}
): Promise<EdgeAccount> {
  const out = new Account()
  theApi = out
  return makeAccountState(ai, appId, loginTree, callbacks, out).then(state =>
    out.setup(ai, state, loginType)
  )
}
