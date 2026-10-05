import { writeFileSync } from "node:fs";
import { buildYanfuScenario } from "../src/scenario.js";

// 导出严复场景的完整只追加事件流，供外部系统按统一事件标识联调。
// 注意：这是事件日志导出（含内部/受限字段），分发时仍须经过 projections 的授权投影。
const { store } = buildYanfuScenario();
const out = JSON.stringify(store.events, null, 2);
writeFileSync(new URL("../data/yanfu-events.json", import.meta.url), out + "\n", "utf8");
console.log(`已导出 ${store.events.length} 条事件到 data/yanfu-events.json`);
