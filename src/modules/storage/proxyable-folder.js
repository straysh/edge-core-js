// @flow

import { Proxyable } from 'yaob'

import { DiskletFile, DiskletFolder } from '../../edge-core-index.js'

export class ProxyableFile extends Proxyable implements DiskletFile {
  _file: DiskletFile

  constructor (file: DiskletFile) {
    super()
    this._file = file
  }

  delete (): Promise<mixed> {
    return this._file.delete()
  }
  getData (): Promise<Uint8Array> {
    return this._file.getData()
  }
  getText (): Promise<string> {
    return this._file.getText()
  }
  setData (data: Array<number> | Uint8Array): Promise<mixed> {
    return this._file.setData(data)
  }
  setText (text: string): Promise<mixed> {
    return this._file.setText(text)
  }
}

export class ProxyableFolder extends Proxyable implements DiskletFolder {
  _fileProxies: { [name: string]: ProxyableFile }
  _folder: DiskletFolder
  _folderProxies: { [name: string]: ProxyableFolder }

  constructor (folder: DiskletFolder) {
    super()
    this._fileProxies = {}
    this._folder = folder
    this._folderProxies = {}
  }

  delete (): Promise<mixed> {
    return this._folder.delete()
  }
  file (name: string): DiskletFile {
    if (this._fileProxies[name] == null) {
      this._fileProxies[name] = new ProxyableFile(this._folder.file(name))
    }
    return this._fileProxies[name]
  }
  folder (name: string): DiskletFolder {
    if (this._folderProxies[name] == null) {
      this._folderProxies[name] = new ProxyableFolder(this._folder.folder(name))
    }
    return this._folderProxies[name]
  }
  listFiles (): Promise<Array<string>> {
    return this._folder.listFiles()
  }
  listFolders (): Promise<Array<string>> {
    return this._folder.listFolders()
  }
}
