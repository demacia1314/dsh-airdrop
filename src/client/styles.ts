const CSS = `
.dua-attach {
  display: inline-flex;
  align-items: center;
}
.dua-attach-menu {
  position: relative;
  display: inline-flex;
}
.dua-attach-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  min-width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #4f5a68);
  cursor: pointer;
}
.dua-attach-button > span {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.dua-attach-button:hover,
.dua-attach-button[aria-expanded='true'] {
  background: var(--dsw-alias-interactive-bg-hover, #eef1f5);
  color: var(--dsw-alias-label-primary, #18202b);
}
.dua-attach-button:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #2d6fe8);
  outline-offset: 1px;
}
.dua-attach-button:disabled {
  cursor: default;
  opacity: .38;
}
.dua-attach [role='tooltip'] {
  position: fixed;
  z-index: 12020;
  max-width: min(260px, calc(100vw - 24px));
  padding: 5px 8px;
  border-radius: 5px;
  background: rgba(23, 28, 36, .94);
  color: #fff;
  font-size: 11px;
  line-height: 16px;
  pointer-events: none;
  white-space: nowrap;
}
.dua-attach [role='tooltip'][data-side='top'] { transform: translate(-50%, -100%); }
.dua-attach [role='tooltip'][data-side='bottom'] { transform: translateX(-50%); }
.dua-attach [role='tooltip'][data-side='right'] { transform: translateY(-50%); }
body > [role='menu']:has([data-dua-attach-choice]) {
  position: fixed;
  z-index: 12010;
  width: 174px;
  padding: 4px;
  border: 1px solid var(--dsw-alias-border-l2, #dfe3e8);
  border-radius: 7px;
  background: var(--dsw-alias-bg-layer-1, #fff);
  box-shadow: 0 10px 28px rgba(18, 24, 40, .16);
  box-sizing: border-box;
}
body > [role='menu']:has([data-dua-attach-choice]) [role='menuitem'] {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 32px;
  padding: 6px 8px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--dsw-alias-label-primary, #18202b);
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  text-align: left;
  cursor: pointer;
}
body > [role='menu']:has([data-dua-attach-choice]) [role='menuitem']:hover,
body > [role='menu']:has([data-dua-attach-choice]) [role='menuitem']:focus-visible {
  background: var(--dsw-alias-interactive-bg-hover, #eef1f5);
  outline: none;
}
body > [role='menu']:has([data-dua-attach-choice]) [role='menuitem'] > span {
  display: inline-flex;
  align-items: center;
  min-width: 0;
}
body > [role='menu']:has([data-dua-attach-choice]) [role='menuitem'] > span:last-of-type {
  flex: 1;
}

.dua-dock {
  display: grid;
  gap: 6px;
  width: min(820px, 100%);
  margin: 0 auto;
  padding: 4px 10px 8px;
  box-sizing: border-box;
}
.dua-native-image-rail {
  min-width: 0;
}
.dua-native-image-rail > div {
  position: relative;
  display: flex;
  align-items: center;
  min-width: 0;
}
.dua-native-image-rail [role='group'] {
  display: flex;
  gap: 6px;
  width: 100%;
  padding: 1px;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  scrollbar-width: none;
}
.dua-native-image-rail [role='group']::-webkit-scrollbar { display: none; }
.dua-native-image-rail [role='group'] > div {
  position: relative;
  flex: 0 0 64px;
  width: 64px;
  height: 64px;
}
.dua-native-image-rail [role='group'] > div > button:first-child {
  display: block;
  width: 64px;
  height: 64px;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l2, #dfe3e8);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2, #eef1f5);
  cursor: zoom-in;
}
.dua-native-image-rail [role='group'] > div > button:first-child img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.dua-native-image-rail [role='group'] > div > button:last-child {
  position: absolute;
  top: 3px;
  right: 3px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, .46);
  border-radius: 50%;
  background: rgba(18, 24, 35, .74);
  color: #fff;
  cursor: pointer;
  opacity: 0;
  transition: opacity .12s ease, background .12s ease;
}
.dua-native-image-rail [role='group'] > div:hover > button:last-child,
.dua-native-image-rail [role='group'] > div > button:last-child:focus-visible { opacity: 1; }
.dua-native-image-rail [role='group'] > div > button:last-child:hover { background: rgba(172, 39, 33, .92); }
.dua-native-image-rail > div > button {
  position: absolute;
  top: 20px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--dsw-alias-border-l2, #dfe3e8);
  border-radius: 50%;
  background: var(--dsw-alias-bg-layer-1, #fff);
  color: var(--dsw-alias-label-secondary, #4f5a68);
  box-shadow: 0 2px 8px rgba(18, 24, 40, .15);
  cursor: pointer;
}
.dua-native-image-rail > div > button:first-child { left: 3px; }
.dua-native-image-rail > div > button:last-child { right: 3px; }

.dua-file-list {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  scrollbar-width: none;
}
.dua-file-list::-webkit-scrollbar { display: none; }
.dua-submit-row {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  min-height: 28px;
}
.dua-submit-row > span {
  min-width: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-error, #b42318);
  font-size: 12px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dua-submit-button { flex: none; }
.dua-file-row {
  --dua-progress: 0%;
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 24px;
  align-items: center;
  flex: 0 0 min(220px, calc(100vw - 42px));
  width: min(220px, 100%);
  min-height: 46px;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l2, #dfe3e8);
  border-radius: 7px;
  background: var(--dsw-specific-input-major, var(--dsw-alias-bg-layer-1, #fff));
  color: var(--dsw-alias-label-primary, #18202b);
  box-sizing: border-box;
}
.dua-file-row:hover { border-color: var(--dsw-alias-border-l1, #b6bec9); }
.dua-file-open {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  min-width: 0;
  min-height: 44px;
  padding: 5px 3px 5px 6px;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.dua-file-open:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #2d6fe8);
  outline-offset: -2px;
}
.dua-file-preparing {
  grid-template-columns: 32px minmax(0, 1fr) 24px;
  gap: 8px;
  padding: 5px 3px 5px 6px;
}
.dua-file-visual {
  position: relative;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  overflow: hidden;
  border-radius: 5px;
  background: var(--dsw-alias-bg-layer-2, #eef1f5);
  color: var(--dsw-alias-label-secondary, #4f5a68);
}
.dua-file-folder { background: #f5e8ad; color: #66551c; }
.dua-file-generic { background: #e9eef5; color: #385d84; }
.dua-file-video { background: #171b22; color: #fff; }
.dua-file-video video { width: 100%; height: 100%; object-fit: cover; opacity: .82; }
.dua-file-video > span {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, .5));
}
.dua-file-copy { display: grid; min-width: 0; }
.dua-file-copy strong {
  overflow: hidden;
  color: var(--dsw-alias-label-primary, #18202b);
  font-size: 12px;
  line-height: 17px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dua-file-copy small {
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary, #6e7785);
  font-size: 10px;
  line-height: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dua-file-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary, #6e7785);
  cursor: pointer;
}
.dua-file-remove:hover {
  background: var(--dsw-alias-interactive-bg-hover-danger, #feeceb);
  color: #b42318;
}
.dua-file-progress {
  position: absolute;
  left: 0;
  bottom: 0;
  width: var(--dua-progress);
  height: 2px;
  background: var(--dsw-alias-state-business-primary, #2d6fe8);
  transition: width .15s linear;
}
.dua-file-error { border-color: var(--dsw-alias-state-error-primary, #d92d20); }
.dua-file-error .dua-file-copy small { color: var(--dsw-alias-state-error-primary, #d92d20); }
.dua-file-spinner svg { animation: dua-spin .8s linear infinite; }
.dua-progress-indeterminate { width: 34%; animation: dua-progress 1.1s ease-in-out infinite; }
@keyframes dua-spin { to { transform: rotate(360deg); } }
@keyframes dua-progress {
  from { transform: translateX(-120%); }
  to { transform: translateX(360%); }
}

.dua-chat-row {
  display: flex;
  justify-content: flex-end;
  width: 100%;
  margin: -6px 0 12px;
  color: var(--dsw-alias-label-primary, #18202b);
  font-family: var(--ds-font-family, ui-sans-serif, system-ui, sans-serif);
}
.dua-chat-attachments {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 220px));
  justify-content: end;
  gap: 6px;
  width: min(446px, calc(100% - 48px));
}
.dua-chat-attachment {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  min-width: 0;
  min-height: 46px;
  padding: 4px 8px 4px 4px;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l2, #dfe3e8);
  border-radius: 7px;
  background: var(--dsw-specific-input-major, var(--dsw-alias-bg-layer-1, #fff));
  color: inherit;
  text-align: left;
  cursor: pointer;
  box-sizing: border-box;
}
.dua-chat-attachment:hover {
  border-color: var(--dsw-alias-border-l1, #b6bec9);
  background: var(--dsw-alias-interactive-bg-hover, #eef1f5);
}
.dua-chat-attachment:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #2d6fe8);
  outline-offset: 1px;
}
.dua-chat-visual {
  position: relative;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  overflow: hidden;
  border-radius: 5px;
  background: var(--dsw-alias-bg-layer-2, #eef1f5);
  color: var(--dsw-alias-label-secondary, #4f5a68);
}
.dua-chat-folder { color: #66551c; background: #f5e8ad; }
.dua-chat-media { background: #161a21; color: #fff; }
.dua-chat-media img,
.dua-chat-media video { display: block; width: 100%; height: 100%; object-fit: cover; }
.dua-chat-media video { opacity: .82; }
.dua-chat-play {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, .55));
}
.dua-chat-file { align-content: center; gap: 0; }
.dua-chat-file small {
  max-width: 30px;
  overflow: hidden;
  font-size: 7px;
  line-height: 9px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dua-chat-copy { display: grid; min-width: 0; }
.dua-chat-copy strong {
  overflow: hidden;
  font-size: 12px;
  line-height: 17px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dua-chat-copy small {
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary, #6e7785);
  font-size: 10px;
  line-height: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* rc.6 ships these atoms without their CSS module payload. */
[data-align='start']:has(> button[data-variant]),
[data-align='end']:has(> button[data-variant]) {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-bottom: 6px;
}
[data-align='start']:has(> button[data-variant]) { justify-content: flex-start; }
[data-align='end']:has(> button[data-variant]) { justify-content: flex-end; }
button[data-variant='single'],
button[data-variant='tile'] {
  display: block;
  padding: 0;
  overflow: hidden;
  border: 0;
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2, #eef1f5);
  color: var(--dsw-alias-label-tertiary, #6e7785);
  cursor: zoom-in;
  box-sizing: border-box;
}
button[data-variant='single'] > img,
button[data-variant='tile'] > img { display: block; width: 100%; height: 100%; object-fit: cover; }
button[data-variant='tile'] { width: 64px; height: 64px; }
button[data-variant] > span {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  padding: 8px;
  font-size: 11px;
  box-sizing: border-box;
}
body > [role='dialog'][aria-modal='true']:has(> img) {
  position: fixed;
  inset: 0;
  z-index: 13000;
  display: grid;
  place-items: center;
  padding: 18px;
  box-sizing: border-box;
}
body > [role='dialog'][aria-modal='true']:has(> img) > div:first-child {
  position: absolute;
  inset: 0;
  background: rgba(4, 7, 12, .84);
  backdrop-filter: blur(5px);
}
body > [role='dialog'][aria-modal='true']:has(> img) > img {
  position: relative;
  z-index: 1;
  display: block;
  max-width: calc(100vw - 36px);
  max-height: calc(100vh - 48px);
  border-radius: 4px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, .42);
}
body > [role='dialog'][aria-modal='true']:has(> img) > button {
  position: fixed;
  top: 14px;
  right: 14px;
  z-index: 2;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, .22);
  border-radius: 50%;
  background: rgba(20, 25, 34, .72);
  color: #fff;
  cursor: pointer;
}
body > [role='dialog'][aria-modal='true']:has(> img) > button:hover { background: rgba(45, 52, 65, .92); }

body > [role='status']:has(svg[width='115'][height='84']) {
  position: fixed;
  inset: 0;
  z-index: 12500;
  display: grid;
  place-items: center;
  padding: 24px;
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-1, #fff) 82%, transparent);
  backdrop-filter: blur(4px);
  color: var(--dsw-alias-label-primary, #18202b);
  pointer-events: none;
  box-sizing: border-box;
}
body > [role='status']:has(svg[width='115'][height='84'])::before {
  content: '';
  position: absolute;
  inset: 16px;
  border: 1.5px dashed color-mix(in srgb, var(--dsw-alias-state-business-primary, #2d6fe8) 76%, transparent);
  border-radius: 8px;
}
body > [role='status']:has(svg[width='115'][height='84']) > div {
  position: relative;
  display: grid;
  justify-items: center;
  gap: 6px;
  text-align: center;
}
body > [role='status']:has(svg[width='115'][height='84']) > div > div:nth-child(2) {
  font-size: 17px;
  line-height: 24px;
  font-weight: 650;
}
body > [role='status']:has(svg[width='115'][height='84']) > div > div:nth-child(3) {
  max-width: 440px;
  color: var(--dsw-alias-label-tertiary, #6e7785);
  font-size: 12px;
  line-height: 18px;
}

body > [role='presentation']:has(> .dua-preview-modal) {
  position: fixed;
  inset: 0;
  z-index: 12800;
  display: grid;
  place-items: center;
  padding: 18px;
  box-sizing: border-box;
}
body > [role='presentation']:has(> .dua-preview-modal) > div:first-child {
  position: absolute;
  inset: 0;
  background: rgba(10, 14, 21, .66);
  backdrop-filter: blur(4px);
}
.dua-preview-modal {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  width: min(880px, 94vw);
  max-height: 88vh;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l2, #dfe3e8);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1, #fff);
  box-shadow: 0 20px 56px rgba(0, 0, 0, .32);
  color: var(--dsw-alias-label-primary, #18202b);
}
.dua-preview-content {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-height: 0;
}
.dua-preview-content > div:first-child {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 46px;
  padding: 0 9px 0 14px;
  border-bottom: 1px solid var(--dsw-alias-border-l2, #dfe3e8);
}
.dua-preview-content > div:first-child h2 {
  flex: 1;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  font-size: 13px;
  line-height: 20px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dua-preview-content > div:first-child button {
  display: inline-grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.dua-preview-content > div:first-child button:hover { background: var(--dsw-alias-interactive-bg-hover, #eef1f5); }
.dua-preview-content > div:last-child {
  min-height: 180px;
  padding: 14px;
  overflow: auto;
  font-size: 13px;
  box-sizing: border-box;
}
.dua-preview-modal > div:has(> .dua-preview-download) {
  display: flex;
  justify-content: flex-end;
  padding: 9px 14px;
  border-top: 1px solid var(--dsw-alias-border-l2, #dfe3e8);
}
.dua-preview-media {
  display: block;
  max-width: 100%;
  max-height: 66vh;
  margin: 0 auto;
  border-radius: 6px;
  background: #0d1117;
}
.dua-preview-audio { display: block; width: min(520px, 100%); margin: 24px auto; }
.dua-preview-pdf {
  display: block;
  width: 100%;
  height: min(68vh, 760px);
  border: 0;
  border-radius: 5px;
  background: #eef1f5;
}
.dua-preview-text {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: 12.5px/1.6 var(--ds-font-family-code, ui-monospace, monospace);
}
.dua-preview-note { margin: 0; color: var(--dsw-alias-label-tertiary, #6e7785); }
.dua-preview-error { margin: 0; color: var(--dsw-alias-state-error-primary, #d92d20); }
.dua-preview-download {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 6px;
  background: var(--dsw-alias-interactive-bg-hover, #eef1f5);
  color: var(--dsw-alias-label-primary, #18202b);
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
}
.dua-preview-download:hover { background: var(--dsw-alias-border-l2, #dfe3e8); }
.dua-folder-list { display: grid; }
.dua-folder-list > div {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 14px;
  padding: 8px 4px;
  border-bottom: 1px solid var(--dsw-alias-border-l2, #dfe3e8);
}
.dua-folder-list > div:first-child { border-top: 1px solid var(--dsw-alias-border-l2, #dfe3e8); }
.dua-folder-list span {
  min-width: 0;
  overflow-wrap: anywhere;
  font-family: var(--ds-font-family-code, ui-monospace, monospace);
}
.dua-folder-list small { color: var(--dsw-alias-label-tertiary, #6e7785); white-space: nowrap; }
.dua-folder-list > .dua-preview-note { padding: 10px 4px 0; }

@media (hover: none), (pointer: coarse) {
  .dua-native-image-rail [role='group'] > div > button:last-child { opacity: 1; }
}
@media (max-width: 560px) {
  .dua-dock { padding-inline: 8px; }
  .dua-file-row { flex-basis: min(214px, calc(100vw - 38px)); }
  .dua-chat-attachments {
    grid-template-columns: minmax(0, 1fr);
    width: min(300px, calc(100% - 24px));
  }
  body > [role='status']:has(svg[width='115'][height='84']) > div > div:nth-child(3) { display: none; }
  body > [role='presentation']:has(> .dua-preview-modal) { padding: 8px; }
  .dua-preview-modal { width: 100%; max-height: 92vh; }
  .dua-preview-pdf { height: 72vh; }
}
`

export function installStyles(): () => void {
  const existing = document.querySelector('style[data-plugin="dsh-universal-attachments"]')
  if (existing !== null) return () => undefined
  const style = document.createElement('style')
  style.dataset.plugin = 'dsh-universal-attachments'
  style.textContent = CSS
  document.head.append(style)
  return () => { style.remove() }
}
