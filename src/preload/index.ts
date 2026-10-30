import { contextBridge, ipcRenderer } from 'electron'
import type { XmApi } from '@shared/api'
import type { AppTask, PipelineEvent } from '@shared/types'

const invoke = <T = unknown>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>

const api: XmApi = {
  app: {
    info: () => invoke('app:info'),
    openDataDir: () => invoke('app:openDataDir'),
    openPath: (p) => invoke('app:openPath', p)
  },
  settings: {
    get: () => invoke('settings:get'),
    save: (patch) => invoke('settings:save', patch),
    test: (model) => invoke('settings:test', model),
    models: (model) => invoke('settings:models', model),
    testEmbedding: (model) => invoke('settings:testEmbedding', model)
  },
  providers: {
    list: () => invoke('providers:list'),
    create: (input, activate) => invoke('providers:create', input, activate),
    update: (id, patch) => invoke('providers:update', id, patch),
    remove: (id) => invoke('providers:remove', id),
    activate: (id) => invoke('providers:activate', id)
  },
  books: {
    list: () => invoke('books:list'),
    get: (id) => invoke('books:get', id),
    concept: (req) => invoke('books:concept', req),
    create: (input) => invoke('books:create', input),
    createBlank: (input) => invoke('books:createBlank', input),
    update: (id, patch) => invoke('books:update', id, patch),
    remove: (id) => invoke('books:remove', id),
    generateBible: (id) => invoke('books:generateBible', id),
    generateVolumes: (id) => invoke('books:generateVolumes', id),
    generateStructure: (id) => invoke('books:generateStructure', id)
  },
  chapters: {
    list: (bookId, withContent) => invoke('chapters:list', bookId, withContent),
    get: (id) => invoke('chapters:get', id),
    save: (id, patch) => invoke('chapters:save', id, patch),
    remove: (id) => invoke('chapters:remove', id),
    write: (bookId, chapterNo) => invoke('chapters:write', bookId, chapterNo),
    rewrite: (bookId, chapterNo) => invoke('chapters:rewrite', bookId, chapterNo),
    generateOutlines: (bookId, from, count) => invoke('chapters:generateOutlines', bookId, from, count),
    summarize: (id) => invoke('chapters:summarize', id),
    deAi: (id, hint) => invoke('chapters:deAi', id, hint),
    deAiPending: (bookId) => invoke('chapters:deAiPending', bookId),
    deAiAdopt: (chapterId, text) => invoke('chapters:deAiAdopt', chapterId, text),
    deAiRollback: (chapterId) => invoke('chapters:deAiRollback', chapterId),
    deAiBatch: (bookId, opts) => invoke('chapters:deAiBatch', bookId, opts),
    check: (id) => invoke('chapters:check', id),
    reviewFix: (id, level) => invoke('chapters:reviewFix', id, level)
  },
  bible: {
    list: (bookId) => invoke('bible:list', bookId),
    save: (entry) => invoke('bible:save', entry),
    remove: (id) => invoke('bible:remove', id)
  },
  outline: {
    list: (bookId) => invoke('outline:list', bookId)
  },
  memory: {
    onAutoRebuilt: (cb: (list: { bookId: string; title: string; reason: string }[]) => void): (() => void) => {
      const h = (_e: Electron.IpcRendererEvent, list: { bookId: string; title: string; reason: string }[]) => cb(list)
      ipcRenderer.on('memory:autoRebuilt', h)
      return () => ipcRenderer.removeListener('memory:autoRebuilt', h)
    },
    overview: (bookId) => invoke('memory:overview', bookId),
    search: (bookId, query) => invoke('memory:search', bookId, query),
    rebuild: (bookId) => invoke('memory:rebuild', bookId),
    volumes: (bookId) => invoke('memory:volumes', bookId),
    foreshadowing: (bookId) => invoke('memory:foreshadowing', bookId),
    addForeshadowing: (input) => invoke('memory:addForeshadowing', input),
    resolveForeshadowing: (bookId, name) => invoke('memory:resolveForeshadowing', bookId, name),
    extractStyle: (sample) => invoke('memory:extractStyle', sample),
    contextPreview: (bookId, chapterNo) => invoke('memory:contextPreview', bookId, chapterNo)
  },
  exporter: {
    book: (bookId, format, saveAs) => invoke('export:book', bookId, format, saveAs)
  },
  cover: {
    generate: (bookId, useAi, variant) => invoke('cover:generate', bookId, useAi, variant),
    read: (bookId) => invoke('cover:read', bookId),
    pick: (bookId) => invoke('cover:pick', bookId)
  },
  update: {
    state: () => invoke('update:state'),
    check: () => invoke('update:check'),
    download: () => invoke('update:download'),
    install: () => invoke('update:install'),
    onState: (cb) => {
      const h = (_e: Electron.IpcRendererEvent, s: unknown) => cb(s)
      ipcRenderer.on('update:state', h)
      return () => ipcRenderer.removeListener('update:state', h)
    }
  },
  tasks: {
    list: () => invoke('tasks:list'),
    get: (id) => invoke('tasks:get', id),
    cancel: (id) => invoke('tasks:cancel', id),
    onEvent: (cb) => {
      const handler = (_e: Electron.IpcRendererEvent, task: AppTask) => cb(task)
      ipcRenderer.on('task:event', handler)
      return () => ipcRenderer.removeListener('task:event', handler)
    }
  },
  pipeline: {
    start: (bookId, from, count, opts) => invoke('pipeline:start', bookId, from, count, opts),
    pause: () => invoke('pipeline:pause'),
    stop: () => invoke('pipeline:stop'),
    status: () => invoke('pipeline:status'),
    onEvent: (cb: (e: PipelineEvent) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, payload: PipelineEvent): void => cb(payload)
      ipcRenderer.on('pipeline:event', listener)
      return () => ipcRenderer.removeListener('pipeline:event', listener)
    }
  },
  tags: {
    vocabulary: (bookId) => invoke('tags:vocabulary', bookId),
    suggest: (bookId) => invoke('tags:suggest', bookId),
    save: (bookId, pick) => invoke('tags:save', bookId, pick)
  },
  publish: {
    status: () => invoke('publish:status'),
    open: () => invoke('publish:open'),
    close: () => invoke('publish:close'),
    probe: () => invoke('publish:probe'),
    captures: () => invoke('publish:captures'),
    clearCaptures: () => invoke('publish:clearCaptures'),
    saveCapture: (capture, role, name) => invoke('publish:saveCapture', capture, role, name),
    templates: () => invoke('publish:templates'),
    setRole: (id, role) => invoke('publish:setRole', id, role),
    removeTemplate: (id) => invoke('publish:removeTemplate', id),
    updateTemplate: (id, patch) => invoke('publish:updateTemplate', id, patch),
    replay: (id, vars) => invoke('publish:replay', id, vars),
    fill: (title, content) => invoke('publish:fill', title, content),
    applyTags: (bookId, pick) => invoke('publish:applyTags', bookId, pick),
    readTags: () => invoke('publish:readTags'),
    publishChapter: (bookId, chapterId, mode) => invoke('publish:publishChapter', bookId, chapterId, mode),
    jobs: (bookId) => invoke('publish:jobs', bookId)
  }
}

contextBridge.exposeInMainWorld('api', api)
