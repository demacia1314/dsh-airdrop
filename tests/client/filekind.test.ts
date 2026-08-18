import { describe, expect, it } from 'vitest'
import { fileExtension, fileVisualKind } from '../../src/client/filekind.js'

describe('fileExtension', () => {
  it('uppercases and truncates the extension', () => {
    expect(fileExtension('notes.txt')).toBe('TXT')
    expect(fileExtension('archive.tar.gz')).toBe('GZ')
    expect(fileExtension('photo.jpeg')).toBe('JPEG')
    expect(fileExtension('song.flac')).toBe('FLAC')
  })

  it('falls back to FILE for dotfiles and missing extensions', () => {
    expect(fileExtension('README')).toBe('FILE')
    expect(fileExtension('.gitignore')).toBe('FILE')
    expect(fileExtension('trailing.')).toBe('FILE')
  })

  it('strips non-alphanumeric characters', () => {
    expect(fileExtension('odd.t-x')).toBe('TX')
  })
})

describe('fileVisualKind', () => {
  it('classifies audio by mime or extension', () => {
    expect(fileVisualKind('clip.bin', 'audio/mpeg')).toBe('audio')
    expect(fileVisualKind('clip.mp3')).toBe('audio')
    expect(fileVisualKind('clip.flac')).toBe('audio')
  })

  it('classifies pdf by mime or extension', () => {
    expect(fileVisualKind('doc.bin', 'application/pdf')).toBe('pdf')
    expect(fileVisualKind('doc.PDF')).toBe('pdf')
  })

  it('classifies archives', () => {
    expect(fileVisualKind('bundle.zip')).toBe('archive')
    expect(fileVisualKind('bundle.tar.gz')).toBe('archive')
    expect(fileVisualKind('bundle.bin', 'application/x-7z-compressed')).toBe('archive')
  })

  it('classifies code and text', () => {
    expect(fileVisualKind('main.ts')).toBe('code')
    expect(fileVisualKind('styles.css')).toBe('code')
    expect(fileVisualKind('data.json')).toBe('code')
    expect(fileVisualKind('notes.md')).toBe('text')
    expect(fileVisualKind('blob.bin', 'text/plain')).toBe('text')
  })

  it('falls back to generic for unknown types', () => {
    expect(fileVisualKind('model.bin')).toBe('generic')
    expect(fileVisualKind('no-extension')).toBe('generic')
  })
})
