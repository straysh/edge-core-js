// @flow

import { Proxyable } from 'yaob'

import type {
  EdgeCurrencyInfo,
  EdgeCurrencyPlugin,
  EdgeCurrencyTools
} from '../../edge-core-index.js'

/**
 * Access to an individual currency plugin's methods.
 */
export class CurrencyTools extends Proxyable<> implements EdgeCurrencyTools {
  _plugin: EdgeCurrencyPlugin

  constructor (plugin: EdgeCurrencyPlugin) {
    super()
    this._plugin = plugin
  }

  get currencyInfo (): EdgeCurrencyInfo {
    return this._plugin.currencyInfo
  }
}
