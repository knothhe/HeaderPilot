export const STORAGE_KEY = 'headerpilot:state';
export const MAX_PROFILES = 50;
export const MAX_HEADERS = 100;

export interface HeaderEntry {
  id: string;
  enabled: boolean;
  name: string;
  value: string;
  operation: 'set' | 'remove';
  target: 'request' | 'response';
}

export interface Profile {
  id: string;
  name: string;
  urlFilter: string;
  headers: HeaderEntry[];
}

export interface AppState {
  version: 1;
  enabled: boolean;
  activeProfileId: string;
  profiles: Profile[];
}

export function createProfile(name = '新 Profile'): Profile {
  return { id: crypto.randomUUID(), name, urlFilter: '', headers: [] };
}

export function createHeader(): HeaderEntry {
  return {
    id: crypto.randomUUID(), enabled: true, name: '', value: '',
    operation: 'set', target: 'request',
  };
}

export function createDefaultState(): AppState {
  const profile = createProfile('Default');
  return { version: 1, enabled: false, activeProfileId: profile.id, profiles: [profile] };
}

export function activeProfile(state: AppState): Profile {
  const profile = state.profiles.find((item) => item.id === state.activeProfileId);
  if (!profile) throw new Error('当前 Profile 不存在。');
  return profile;
}

const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const HEADER_VALUE = /^[\t\x20-\x7e\x80-\xff]*$/;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// Validate both stored data and popup messages at the background boundary.
export function validateState(value: unknown): asserts value is AppState {
  if (!isRecord(value) || value.version !== 1 || typeof value.enabled !== 'boolean' ||
      typeof value.activeProfileId !== 'string' || !Array.isArray(value.profiles) ||
      value.profiles.length < 1 || value.profiles.length > MAX_PROFILES) {
    throw new Error(`配置格式不正确，需要 1 至 ${MAX_PROFILES} 个 Profile。`);
  }
  const profileIds = new Set<string>();
  const profileNames = new Set<string>();
  for (const profile of value.profiles) {
    if (!isRecord(profile) || typeof profile.id !== 'string' || !profile.id ||
        typeof profile.name !== 'string' || !profile.name.trim() || profile.name.length > 40 ||
        typeof profile.urlFilter !== 'string' || profile.urlFilter.length > 1000 ||
        /[^\x20-\x7e]/.test(profile.urlFilter) ||
        !Array.isArray(profile.headers) || profile.headers.length > MAX_HEADERS) {
      throw new Error('Profile 名称需为 1 至 40 个字符，URL 过滤器只能使用 ASCII 字符，每个 Profile 最多 100 条 Header。');
    }
    const profileName = profile.name.trim().toLowerCase();
    if (profileIds.has(profile.id) || profileNames.has(profileName)) {
      throw new Error('Profile 名称或 ID 不能重复。');
    }
    profileIds.add(profile.id);
    profileNames.add(profileName);
    const headerIds = new Set<string>();
    const headerNames = new Set<string>();
    for (const header of profile.headers) {
      if (!isRecord(header) || typeof header.id !== 'string' || !header.id ||
          typeof header.enabled !== 'boolean' || typeof header.name !== 'string' ||
          !HEADER_NAME.test(header.name) || header.name.length > 256 ||
          typeof header.value !== 'string' || header.value.length > 8192 ||
          !HEADER_VALUE.test(header.value) ||
          (header.operation !== 'set' && header.operation !== 'remove') ||
          (header.target !== 'request' && header.target !== 'response')) {
        throw new Error(`「${profile.name}」中存在无效 Header。名称仅支持 HTTP token 字符，值不能包含换行、控制字符或非 Latin-1 字符。`);
      }
      if (headerIds.has(header.id)) throw new Error('Header ID 不能重复。');
      headerIds.add(header.id);
      const key = `${header.target}:${header.name.toLowerCase()}`;
      if (header.enabled && headerNames.has(key)) {
        throw new Error(`「${profile.name}」中有重复的 ${header.target === 'request' ? '请求' : '响应'} Header：${header.name}。`);
      }
      if (header.enabled) headerNames.add(key);
    }
  }
  if (!profileIds.has(value.activeProfileId)) throw new Error('当前 Profile 不存在。');
}
