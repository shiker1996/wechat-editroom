import { mountAccountContextEditor } from "../core/account-context.js";

export default async function loadAccountView() {
  const result = await mountAccountContextEditor(document.getElementById("account-context-editor"), {
    onSaved: (saved) => {
      const badge = document.getElementById("account-context-config-badge");
      if (badge) badge.innerHTML = '<i class="is-ready"></i><span>已生效</span>';
      window.dispatchEvent(new CustomEvent("account-context-updated", { detail: saved }));
    },
  });
  const badge = document.getElementById("account-context-config-badge");
  if (badge && result) badge.innerHTML = result.configured ? '<i class="is-ready"></i><span>已配置</span>' : '<i></i><span>待初始化</span>';
}
