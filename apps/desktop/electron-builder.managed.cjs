const packageMetadata = require("./package.json");

const base = packageMetadata.build;

module.exports = {
	...base,
	// 受管制品只额外携带版本锁定的原生 Pi；普通版的扩展资源、依赖镜像和
	// xueprompts 数据库不进入受管安装包，避免形成额外模型或配置入口。
	extraResources: [
		{
			from: "../../packages/coding-agent/dist",
			to: "pi-runtime",
			filter: ["pi", "pi.exe"],
		},
	],
};
