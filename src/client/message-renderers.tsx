import { createElement, type ComponentType, type ReactNode } from 'react'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import { isAttachmentOnlySource } from '../shared/manifest.js'

const PLUGIN_NAME = 'dsh-airdrop'
const LEGACY_PLUGIN_NAME = 'dsh-universal-attachments'
const CONVERSATION_LOCALE = 'conversation'
const NATIVE_RENDERER_PRIORITY = 0

type GuardedMessageKind = 'user' | 'context'

interface GuardedMessageProps {
  readonly user: ChatNodeViewProps<'user'>
  readonly context: ChatNodeViewProps<'context'>
}

export interface NativeRendererGuard<Kind extends GuardedMessageKind> {
  readonly component: ComponentType<GuardedMessageProps[Kind]>
  readonly priority: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isHandledAttachmentContext(source: unknown): boolean {
  return isRecord(source)
    && source.kind === 'plugin'
    && (source.plugin === PLUGIN_NAME || source.plugin === LEGACY_PLUGIN_NAME)
    && source.historyHandledBy === 'user-message'
}

function entryPriority(entry: StoredEntry): number {
  return entry.options.priority ?? NATIVE_RENDERER_PRIORITY
}

function isNativeConversationRenderer(entry: StoredEntry, key: GuardedMessageKind): boolean {
  return entry.options.key === key
    && entryPriority(entry) === NATIVE_RENDERER_PRIORITY
    && entry.locale === CONVERSATION_LOCALE
    && entry.inject === undefined
    && entry.store === undefined
    && entry.children === undefined
    && entry.component !== null
    && (typeof entry.component === 'function' || typeof entry.component === 'object')
}

/**
 * Shadow only DSH's baseline renderer. The guard priority is the nearest
 * representable number below zero, so every entry that would beat native
 * priority 0 still beats this guard as well.
 */
export function nativeRendererGuard<Kind extends GuardedMessageKind>(
  entries: readonly StoredEntry[],
  key: Kind,
): NativeRendererGuard<Kind> | undefined {
  const native = entries.filter(entry => isNativeConversationRenderer(entry, key))
  const [baseline] = native
  if (native.length !== 1 || baseline === undefined) return undefined

  const priority = -Number.MIN_VALUE
  if (entries.some(entry => entry.options.key === key && entryPriority(entry) === priority)) return undefined
  return {
    component: baseline.component as ComponentType<GuardedMessageProps[Kind]>,
    priority,
  }
}

export function createAttachmentAwareUserRenderer(
  NativeUserRenderer: ComponentType<ChatNodeViewProps<'user'>>,
): (props: ChatNodeViewProps<'user'>) => ReactNode {
  return function AttachmentAwareUserRenderer(props): ReactNode {
    if (isAttachmentOnlySource(props.node.data.source)) return null
    return createElement(NativeUserRenderer, props)
  }
}

export function createAttachmentAwareContextRenderer(
  NativeContextRenderer: ComponentType<ChatNodeViewProps<'context'>>,
): (props: ChatNodeViewProps<'context'>) => ReactNode {
  return function AttachmentAwareContextRenderer(props): ReactNode {
    if (isHandledAttachmentContext(props.node.data.source)) return null
    return createElement(NativeContextRenderer, props)
  }
}
