// 设置导入校验：把任意 JSON 规整为可安全写入 storage 的设置对象；不合法即抛错。
// 数字区间做钳制而非拒绝，导入更宽容；字符串字段严格校验。

export function validateSettingsImport(data) {
  if (!data || typeof data !== "object" || !data.settings || typeof data.settings !== "object") {
    throw new Error("文件缺少 settings 字段，不是本扩展的配置导出");
  }
  const s = data.settings;
  const p = s.providers && typeof s.providers === "object" ? s.providers : {};
  const glm = p.glm && typeof p.glm === "object" ? p.glm : {};
  const go = p.go && typeof p.go === "object" ? p.go : {};
  if (glm.planExpiry && !/^\d{4}-\d{2}-\d{2}$/.test(String(glm.planExpiry))) {
    throw new Error("GLM 到期日期格式应为 YYYY-MM-DD");
  }
  const clampNum = (v, def, min, max) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return def;
    return Math.min(max, Math.max(min, n));
  };
  return {
    providers: {
      glm: {
        enabled: glm.enabled !== false,
        apiKey: typeof glm.apiKey === "string" ? glm.apiKey.trim() : "",
        planExpiry: typeof glm.planExpiry === "string" ? glm.planExpiry : "",
      },
      go: {
        enabled: go.enabled === true,
        apiKey: typeof go.apiKey === "string" ? go.apiKey.trim() : "",
      },
    },
    refreshMin: clampNum(s.refreshMin, 10, 1, 30),
    badgeCycleSec: clampNum(s.badgeCycleSec, 10, 5, 60),
    notify: s.notify === true,
  };
}
