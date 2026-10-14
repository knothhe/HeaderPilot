import { defineConfig } from 'wxt';

export default defineConfig({
  manifestVersion: 3,
  manifest: {
    name: 'HeaderPilot',
    description: '通过多个 Profile 管理请求和响应 Header，随时开启或暂停。',
    minimum_chrome_version: '120',
    permissions: ['storage', 'declarativeNetRequestWithHostAccess'],
    host_permissions: ['http://*/*', 'https://*/*'],
    action: { default_title: 'HeaderPilot · HTTP Header 管理' },
  },
});
