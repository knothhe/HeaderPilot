import './style.css';
import { send, isPreview } from '../../lib/client';
import {
  activeProfile, createHeader, createProfile, MAX_HEADERS, MAX_PROFILES,
  validateState, type AppState, type HeaderEntry,
} from '../../lib/model';

const root = document.querySelector<HTMLDivElement>('#app')!;
if (isPreview) document.body.classList.add('preview');
let state: AppState;
let revision = 0;
let powerRevision = 0;
type Dialog = 'create' | 'rename' | 'delete';
type SaveStatus = 'saved' | 'saving' | 'draft' | 'error';
type RuleField = 'target' | 'operation';
const ruleChoices = {
  target: [['request', '请求'], ['response', '响应']],
  operation: [['set', '设置'], ['remove', '移除']],
} as const;
let ruleTrigger: HTMLButtonElement | undefined;

const paths: Record<string, string> = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h4"/>',
  edit: '<path d="m16 3 5 5-12 12H4v-5L16 3ZM13 6l5 5"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a17 17 0 0 1 0 18 17 17 0 0 1 0-18Z"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  chevron: '<path d="m8 10 4 4 4-4"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
};
const icon = (name: string) => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? ''}</svg>`;
const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]!);
const errorText = (error: unknown) => error instanceof Error ? error.message : '保存失败，请重试。';

function setStatus(status: SaveStatus, error = '') {
  const label = root.querySelector<HTMLElement>('#save-status')!;
  label.dataset.state = status;
  label.setAttribute('aria-label', { saved: '已保存', saving: '正在保存', draft: '未保存', error: '保存失败' }[status]);
  label.title = error || { saved: '已自动保存', saving: '正在保存', draft: '填写完整后自动保存', error: '保存失败' }[status];
  const alert = root.querySelector<HTMLElement>('#save-error')!;
  alert.hidden = !error;
  if (alert.textContent !== error) alert.textContent = error;
}

async function persist(): Promise<boolean> {
  const current = ++revision;
  try {
    validateState(state);
    setStatus('saving');
    await send({ type: 'save-edits', state });
    if (current === revision) setStatus('saved');
    return true;
  } catch (error) {
    if (current === revision) setStatus('error', errorText(error));
    return false;
  }
}

async function profileAction(change: (draft: AppState) => void) {
  const previous = structuredClone(state);
  const next = structuredClone(state);
  try {
    change(next);
    validateState(next);
  } catch (error) {
    ++revision;
    setStatus('error', errorText(error));
    return;
  }
  state = next;
  syncView();
  const current = revision + 1;
  if (!await persist() && current === revision) {
    state = previous;
    syncView();
  }
}

function uniqueName(base: string) {
  let name = base.slice(0, 34);
  let index = 2;
  while (state.profiles.some((profile) => profile.name.toLowerCase() === name.toLowerCase())) {
    name = `${base.slice(0, 34)} ${index++}`;
  }
  return name;
}

function headerMarkup(header: HeaderEntry, index: number) {
  return `<article class="header-card" data-header="${escape(header.id)}">
    <div class="header-card-top">
      <label class="rule-enabled"><input type="checkbox" data-field="enabled" /><span class="rule-number">${String(index + 1).padStart(2, '0')}</span></label>
      <button type="button" class="select-trigger rule-select" role="combobox" data-rule-field="target" aria-haspopup="listbox" aria-expanded="false" aria-controls="rule-options"><span class="select-value"></span>${icon('chevron')}</button>
      <button type="button" class="select-trigger rule-select" role="combobox" data-rule-field="operation" aria-haspopup="listbox" aria-expanded="false" aria-controls="rule-options" title="设置：添加或覆盖 Header"><span class="select-value"></span>${icon('chevron')}</button>
      <button class="icon-button danger delete-header">${icon('trash')}</button>
    </div>
    <div class="header-fields">
      <input data-field="name" placeholder="Header 名称" maxlength="256" autocomplete="off" spellcheck="false" />
      <input data-field="value" maxlength="8192" autocomplete="off" spellcheck="false" />
    </div>
  </article>`;
}

// Reuse each row by ID. Normal edits never replace nodes or reset the caret.
function syncHeaders() {
  const headers = activeProfile(state).headers;
  const list = root.querySelector<HTMLElement>('.header-list')!;
  const existing = new Map(Array.from(list.querySelectorAll<HTMLElement>('[data-header]'), (card) => [card.dataset.header!, card]));
  const ids = new Set(headers.map((header) => header.id));
  existing.forEach((card, id) => { if (!ids.has(id)) card.remove(); });
  if (ruleTrigger && !ruleTrigger.isConnected) closePopover('rule-options');
  if (headers.length) list.querySelector('.empty-state')?.remove();
  headers.forEach((header, index) => {
    let card = existing.get(header.id);
    if (!card) {
      const template = document.createElement('template');
      template.innerHTML = headerMarkup(header, index);
      card = template.content.firstElementChild as HTMLElement;
    }
    if (list.children[index] !== card) list.insertBefore(card, list.children[index] ?? null);
    card.setAttribute('aria-label', `Header 规则 ${index + 1}`);
    card.classList.toggle('is-disabled', !header.enabled);
    card.querySelector('.rule-number')!.textContent = String(index + 1).padStart(2, '0');
    const enabled = card.querySelector<HTMLInputElement>('[data-field="enabled"]')!;
    enabled.checked = header.enabled;
    enabled.setAttribute('aria-label', `启用规则 ${index + 1}`);
    for (const field of ['name', 'value'] as const) {
      const input = card.querySelector<HTMLInputElement>(`[data-field="${field}"]`)!;
      if (input.value !== header[field]) input.value = header[field];
      const label = { name: '的 Header 名称', value: '的 Header 值', target: '的方向', operation: '的操作' }[field];
      input.setAttribute('aria-label', `规则 ${index + 1} ${label}`);
    }
    for (const field of ['target', 'operation'] as const) {
      const trigger = card.querySelector<HTMLButtonElement>(`[data-rule-field="${field}"]`)!;
      trigger.querySelector('.select-value')!.textContent = ruleChoices[field].find(([value]) => value === header[field])![1];
      trigger.setAttribute('aria-label', `规则 ${index + 1} 的${field === 'target' ? '方向' : '操作'}`);
    }
    const value = card.querySelector<HTMLInputElement>('[data-field="value"]')!;
    value.disabled = header.operation === 'remove';
    value.placeholder = header.operation === 'remove' ? '无需填写' : '值';
    const remove = card.querySelector<HTMLButtonElement>('.delete-header')!;
    remove.title = `删除规则 ${index + 1}`;
    remove.setAttribute('aria-label', remove.title);
  });
  if (!headers.length && !list.querySelector('.empty-state')) {
    list.innerHTML = '<div class="empty-state">暂无规则</div>';
  }
  const count = root.querySelector<HTMLElement>('.count')!;
  const enabledCount = headers.filter((header) => header.enabled).length;
  count.textContent = `${enabledCount}/${headers.length}`;
  count.title = `${enabledCount} 条已勾选，共 ${headers.length} 条`;
  root.querySelector<HTMLButtonElement>('#add-header')!.disabled = headers.length >= MAX_HEADERS;
  const option = Array.from(root.querySelectorAll<HTMLElement>('[data-profile]')).find((item) => item.dataset.profile === state.activeProfileId);
  const optionCount = option?.querySelector('.profile-option-count');
  if (optionCount) optionCount.textContent = String(headers.length);
}

function syncPower() {
  const label = root.querySelector<HTMLElement>('.power-status')!;
  label.textContent = state.enabled ? '已开启' : '已暂停';
  label.classList.toggle('is-on', state.enabled);
  root.querySelector('#power')!.setAttribute('aria-checked', String(state.enabled));
}

function syncView() {
  const selected = activeProfile(state);
  root.querySelector('#profile-selected')!.textContent = selected.name;
  root.querySelector<HTMLElement>('#profiles')!.title = selected.name;
  const options = root.querySelector<HTMLElement>('#profile-options')!;
  options.innerHTML = state.profiles.map((profile) => `<button type="button" role="option" data-profile="${escape(profile.id)}" aria-label="${escape(profile.name)}" aria-selected="${profile.id === state.activeProfileId}" tabindex="-1" title="${escape(profile.name)}"><span class="profile-option-check">${icon('check')}</span><span class="profile-option-name">${escape(profile.name)}</span><span class="profile-option-count" title="Header 数量">${profile.headers.length}</span></button>`).join('');
  for (const id of ['new-profile', 'duplicate-profile']) {
    root.querySelector<HTMLButtonElement>(`#${id}`)!.disabled = state.profiles.length >= MAX_PROFILES;
  }
  root.querySelector<HTMLButtonElement>('#delete-profile')!.disabled = state.profiles.length === 1;
  const profile = activeProfile(state);
  const input = root.querySelector<HTMLInputElement>('#url-filter')!;
  if (input.value !== profile.urlFilter) input.value = profile.urlFilter;
  const pill = root.querySelector<HTMLElement>('.scope-pill')!;
  pill.textContent = profile.urlFilter.trim() || '全部网站';
  pill.title = profile.urlFilter.trim();
  syncPower();
  syncHeaders();
}

// Mount the shell once. Saving and toggling only update the relevant controls.
function render() {
  root.innerHTML = `
    ${isPreview ? '<div class="preview-banner">界面预览</div>' : ''}
    <main><fieldset class="editor">
      <section class="profile-section" aria-label="Profile 管理"><div class="profile-toolbar">
        <span class="profile-label">Profile</span>
        <button id="profiles" class="select-trigger" role="combobox" aria-label="当前 Profile" aria-haspopup="listbox" aria-expanded="false" aria-controls="profile-options"><span id="profile-selected" class="select-value"></span>${icon('chevron')}</button>
        <button class="icon-button" id="profile-more" title="更多 Profile 操作" aria-label="更多 Profile 操作" aria-haspopup="menu" aria-expanded="false" aria-controls="profile-menu">${icon('more')}</button>
        <div class="power-control"><span class="power-status"></span><button id="power" class="switch" role="switch" aria-checked="false" aria-label="全局 Header 修改开关"><span></span></button></div>
        <div id="profile-options" class="profile-popover profile-options" role="listbox" aria-label="选择 Profile" popover="manual"></div>
        <div id="profile-menu" class="profile-popover profile-menu" role="menu" aria-label="Profile 操作" popover="manual">
          <button role="menuitem" id="new-profile" tabindex="-1">${icon('plus')}新建 Profile</button>
          <button role="menuitem" id="duplicate-profile" tabindex="-1">${icon('copy')}复制 Profile</button>
          <button role="menuitem" id="rename-profile" tabindex="-1">${icon('edit')}重命名 Profile</button>
          <div class="menu-divider" role="separator"></div>
          <button role="menuitem" class="danger" id="delete-profile" tabindex="-1">${icon('trash')}删除 Profile</button>
        </div>
      </div></section>
      <section class="scope-section" aria-labelledby="scope-heading">
        <h2 id="scope-heading"><button id="toggle-scope" class="scope-toggle" aria-label="编辑匹配范围" aria-expanded="false" aria-controls="scope-editor">${icon('globe')}匹配范围<span class="scope-pill"></span>${icon('chevron')}</button></h2>
        <div id="scope-editor" hidden><input id="url-filter" aria-label="URL 过滤器" placeholder="留空匹配全部，例：||example.com^" title="||example.com^ 匹配域名及子域名" maxlength="1000" autocomplete="off" spellcheck="false" /></div>
      </section>
      <section class="headers-section" aria-labelledby="headers-heading">
        <div class="section-heading"><h2 id="headers-heading">Headers <span class="count"></span><span id="save-status" class="save-status" role="status" aria-live="polite">自动保存</span></h2><button id="add-header" class="add-header">${icon('plus')}添加 Header</button></div>
        <p id="save-error" class="save-error" role="alert" hidden></p>
        <div class="header-list"></div>
      </section>
    </fieldset></main>
    <div id="rule-options" class="profile-popover rule-options" role="listbox" aria-label="规则选项" popover="manual"></div>
    <dialog id="profile-dialog"></dialog>`;
  syncView();
  setStatus('saved');
  for (const id of popoverIds) {
    root.querySelector(`#${id}`)!.addEventListener('toggle', () => {
      popoverTrigger(id)?.setAttribute('aria-expanded', String(root.querySelector(`#${id}`)!.matches(':popover-open')));
    });
  }
  root.querySelector('.header-list')!.addEventListener('scroll', () => closePopover('rule-options'));
}

const popoverIds = ['profile-options', 'profile-menu', 'rule-options'] as const;
type SelectorPopover = typeof popoverIds[number];
const popoverTrigger = (id: SelectorPopover) => id === 'rule-options' ? ruleTrigger : root.querySelector<HTMLButtonElement>(id === 'profile-options' ? '#profiles' : '#profile-more');

function closePopover(id: SelectorPopover, restoreFocus = false) {
  const popover = root.querySelector<HTMLElement>(`#${id}`)!;
  if (popover.matches(':popover-open')) popover.hidePopover();
  popoverTrigger(id)?.setAttribute('aria-expanded', 'false');
  if (restoreFocus) popoverTrigger(id)?.focus();
}

function openPopover(id: SelectorPopover, edge?: 'first' | 'last') {
  for (const other of popoverIds) if (other !== id) closePopover(other);
  const trigger = popoverTrigger(id);
  if (!trigger?.isConnected) return;
  const popover = root.querySelector<HTMLElement>(`#${id}`)!;
  const anchor = trigger.getBoundingClientRect();
  const width = Math.min(id === 'profile-options' ? anchor.width : id === 'rule-options' ? 128 : 174, window.innerWidth - 16);
  popover.style.width = `${width}px`;
  popover.showPopover();
  const below = window.innerHeight - anchor.bottom - 8;
  const above = anchor.top - 8;
  const openBelow = below >= Math.min(popover.scrollHeight, 240) || below >= above;
  const height = Math.min(240, Math.max(0, openBelow ? below : above));
  popover.style.maxHeight = `${height}px`;
  popover.style.left = `${Math.max(8, Math.min(id === 'profile-menu' ? anchor.right - width : anchor.left, window.innerWidth - width - 8))}px`;
  popover.style.top = `${openBelow ? anchor.bottom + 4 : anchor.top - Math.min(popover.scrollHeight, height) - 4}px`;
  trigger.setAttribute('aria-expanded', 'true');
  const choices = Array.from(popover.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
  const selected = popover.querySelector<HTMLButtonElement>('[aria-selected="true"]');
  (edge === 'last' ? choices.at(-1) : edge === 'first' ? choices[0] : selected ?? choices[0])?.focus();
}

function togglePopover(id: SelectorPopover) {
  if (root.querySelector(`#${id}`)!.matches(':popover-open')) closePopover(id, true);
  else openPopover(id);
}

function openRuleOptions(trigger: HTMLButtonElement, edge?: 'first' | 'last', toggle = false) {
  const options = root.querySelector<HTMLElement>('#rule-options')!;
  if (toggle && ruleTrigger === trigger && options.matches(':popover-open')) {
    closePopover('rule-options', true);
    return;
  }
  closePopover('rule-options');
  ruleTrigger = trigger;
  const field = trigger.dataset.ruleField as RuleField;
  const header = activeProfile(state).headers.find((item) => item.id === trigger.closest<HTMLElement>('[data-header]')!.dataset.header)!;
  options.setAttribute('aria-label', `选择${trigger.getAttribute('aria-label')}`);
  options.innerHTML = ruleChoices[field].map(([value, label]) => `<button type="button" role="option" data-rule-value="${value}" aria-label="${label}" aria-selected="${header[field] === value}" tabindex="-1"><span class="profile-option-check">${icon('check')}</span><span>${label}</span></button>`).join('');
  openPopover('rule-options', edge);
}

document.addEventListener('pointerdown', (event) => {
  const target = event.target as Node;
  for (const id of popoverIds) {
    const popover = root.querySelector<HTMLElement>(`#${id}`);
    if (popover?.matches(':popover-open') && !popover.contains(target) && !popoverTrigger(id)?.contains(target)) closePopover(id);
  }
});

let typeahead = '';
let typedAt = 0;
root.addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement;
  const id = popoverIds.find((id) => target.closest(`#${id}`));
  if (!id) {
    if ((target.id === 'profiles' || target.id === 'profile-more' || target.matches('[data-rule-field]')) && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const edge = event.key === 'End' || event.key === 'ArrowUp' ? 'last' : event.key === 'Home' ? 'first' : undefined;
      if (target.matches('[data-rule-field]')) openRuleOptions(target as HTMLButtonElement, edge);
      else openPopover(target.id === 'profiles' ? 'profile-options' : 'profile-menu', edge);
    }
    return;
  }
  if (event.key === 'Escape' || event.key === 'Tab') {
    if (event.key === 'Escape') event.preventDefault();
    closePopover(id, true);
    return;
  }
  const choices = Array.from(root.querySelectorAll<HTMLButtonElement>(`#${id} button:not(:disabled)`));
  const current = choices.indexOf(target as HTMLButtonElement);
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length;
    choices[next]?.focus();
  } else if (id !== 'profile-menu' && event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    const now = Date.now();
    typeahead = now - typedAt < 600 ? typeahead + event.key.toLowerCase() : event.key.toLowerCase();
    typedAt = now;
    choices.find((choice) => choice.getAttribute('aria-label')!.toLowerCase().startsWith(typeahead))?.focus();
  }
});

async function togglePower() {
  const current = ++revision;
  const toggle = ++powerRevision;
  const previous = state.enabled;
  state.enabled = !previous;
  syncPower();
  setStatus('saving');
  try {
    const next = await send({ type: 'set-enabled', enabled: state.enabled });
    if (toggle === powerRevision) {
      state.enabled = next.enabled;
      syncPower();
    }
    if (current === revision) setStatus('saved');
  } catch (error) {
    if (toggle === powerRevision) { state.enabled = previous; syncPower(); }
    if (current === revision) setStatus('error', errorText(error));
  }
}

function updateInput(input: HTMLInputElement) {
  if (input.id === 'url-filter') {
    activeProfile(state).urlFilter = input.value;
    const pill = root.querySelector<HTMLElement>('.scope-pill')!;
    pill.textContent = input.value.trim() || '全部网站';
    pill.title = input.value.trim();
  } else {
    const card = input.closest<HTMLElement>('[data-header]');
    if (!card) return;
    const header = activeProfile(state).headers.find((item) => item.id === card.dataset.header)!;
    switch (input.dataset.field) {
      case 'enabled': header.enabled = (input as HTMLInputElement).checked; break;
      case 'name': header.name = input.value; break;
      case 'value': header.value = input.value; break;
      default: return;
    }
    syncHeaders();
  }
  void persist();
}

root.addEventListener('input', (event) => {
  const input = event.target;
  if (input instanceof HTMLInputElement && input.type !== 'checkbox' && !(event as InputEvent).isComposing) updateInput(input);
});
root.addEventListener('compositionend', (event) => {
  if (event.target instanceof HTMLInputElement) updateInput(event.target);
});
root.addEventListener('change', (event) => {
  const input = event.target;
  if (input instanceof HTMLInputElement && input.type === 'checkbox') {
    updateInput(input);
  }
});
root.addEventListener('click', (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>('button');
  if (!button || button.disabled) return;
  if (button.dataset.ruleField) {
    openRuleOptions(button, undefined, true);
    return;
  }
  if (button.dataset.ruleValue && ruleTrigger) {
    const field = ruleTrigger.dataset.ruleField as RuleField;
    const header = activeProfile(state).headers.find((item) => item.id === ruleTrigger!.closest<HTMLElement>('[data-header]')?.dataset.header);
    closePopover('rule-options', true);
    if (!header) return;
    const value = button.dataset.ruleValue;
    if (field === 'target' && (value === 'request' || value === 'response')) header.target = value;
    if (field === 'operation' && (value === 'set' || value === 'remove')) {
      header.operation = value;
      if (value === 'remove') header.value = '';
    }
    syncHeaders();
    void persist();
    return;
  }
  if (button.dataset.profile) {
    const id = button.dataset.profile;
    closePopover('profile-options', true);
    if (id !== state.activeProfileId) void profileAction((draft) => { draft.activeProfileId = id; });
    return;
  }
  if (button.closest('#profile-menu')) closePopover('profile-menu', true);
  switch (button.id) {
    case 'profiles': togglePopover('profile-options'); break;
    case 'profile-more': togglePopover('profile-menu'); break;
    case 'power': void togglePower(); break;
    case 'new-profile': openDialog('create'); break;
    case 'rename-profile': openDialog('rename'); break;
    case 'delete-profile': openDialog('delete'); break;
    case 'duplicate-profile':
      void profileAction((draft) => {
        const original = activeProfile(draft);
        const copy = { ...structuredClone(original), id: crypto.randomUUID(), name: uniqueName(`${original.name} 副本`) };
        copy.headers = copy.headers.map((header) => ({ ...header, id: crypto.randomUUID() }));
        draft.profiles.push(copy);
        draft.activeProfileId = copy.id;
      });
      break;
    case 'toggle-scope': {
      const editor = root.querySelector<HTMLElement>('#scope-editor')!;
      editor.hidden = !editor.hidden;
      button.setAttribute('aria-expanded', String(!editor.hidden));
      if (!editor.hidden) root.querySelector<HTMLInputElement>('#url-filter')!.focus();
      break;
    }
    case 'add-header': {
      const header = createHeader();
      activeProfile(state).headers.push(header);
      ++revision;
      syncHeaders();
      setStatus('draft');
      const cards = root.querySelectorAll('[data-header]');
      cards[cards.length - 1]?.querySelector<HTMLInputElement>('[data-field="name"]')?.focus();
      break;
    }
    default:
      if (button.classList.contains('delete-header')) {
        const id = button.closest<HTMLElement>('[data-header]')!.dataset.header;
        activeProfile(state).headers = activeProfile(state).headers.filter((header) => header.id !== id);
        syncHeaders();
        void persist();
      }
  }
});

function openDialog(kind: Dialog) {
  const dialog = root.querySelector<HTMLDialogElement>('#profile-dialog')!;
  const profile = activeProfile(state);
  const title = kind === 'create' ? '新建 Profile' : kind === 'rename' ? '重命名 Profile' : '删除 Profile';
  dialog.innerHTML = `<form>
    <div class="dialog-heading"><h2>${title}</h2><button type="button" class="icon-button close-dialog" aria-label="关闭对话框">${icon('close')}</button></div>
    ${kind === 'delete'
      ? `<p class="dialog-description">确认删除「${escape(profile.name)}」及其中的 ${profile.headers.length} 条规则？此操作无法撤销。</p>`
      : `<label class="dialog-label" for="profile-name">Profile 名称</label><input id="profile-name" name="name" required maxlength="40" value="${escape(kind === 'rename' ? profile.name : uniqueName('新 Profile'))}" autocomplete="off" />`}
    <p id="dialog-error" role="alert" class="error"></p>
    <div class="dialog-actions"><button type="button" class="secondary-button close-dialog">取消</button><button type="submit" class="primary-button ${kind === 'delete' ? 'delete-button' : ''}">${kind === 'delete' ? '确认删除' : '保存 Profile'}</button></div>
  </form>`;
  dialog.querySelectorAll('.close-dialog').forEach((button) => button.addEventListener('click', () => dialog.close()));
  dialog.querySelector('form')!.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = dialog.querySelector<HTMLInputElement>('#profile-name')?.value.trim() ?? '';
    if (kind !== 'delete' && (!name || state.profiles.some((item) => item.name.toLowerCase() === name.toLowerCase() && (kind === 'create' || item.id !== profile.id)))) {
      dialog.querySelector('#dialog-error')!.textContent = '请输入不重复的 Profile 名称。';
      return;
    }
    dialog.close();
    void profileAction((draft) => {
      if (kind === 'create') {
        const next = createProfile(name);
        draft.profiles.push(next);
        draft.activeProfileId = next.id;
      } else if (kind === 'rename') {
        activeProfile(draft).name = name;
      } else {
        draft.profiles = draft.profiles.filter((item) => item.id !== profile.id);
        draft.activeProfileId = draft.profiles[0]!.id;
      }
    });
  });
  dialog.showModal();
  dialog.querySelector<HTMLInputElement>('#profile-name')?.select();
}

async function init() {
  root.setAttribute('aria-busy', 'true');
  try {
    state = await send({ type: 'get-state' });
    render();
  } catch (error) {
    root.innerHTML = `<div class="load-error"><h1>暂时无法加载配置</h1><p>${escape(errorText(error))}</p><button class="primary-button" id="retry">重试</button></div>`;
    root.querySelector('#retry')?.addEventListener('click', () => { void init(); });
  } finally {
    root.removeAttribute('aria-busy');
  }
}

void init();
