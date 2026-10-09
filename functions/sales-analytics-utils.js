const crypto = require("node:crypto");

const SALES_ANALYTICS_SHARD_COUNT = 16;

function getSalesDateKey(value) {
	if (!value) return null;
	const date = value && typeof value.toDate === "function" ? value.toDate() : new Date(value);
	if (Number.isNaN(date.getTime())) return null;
	return date.toISOString().slice(0, 10);
}

function createSalesContribution(sale) {
	if (!sale || typeof sale !== "object") {
		return {revenue: 0, transactionCount: 0, date: null};
	}

	const total = Number(sale.total);
	return {
		revenue: Number.isFinite(total) ? total : 0,
		transactionCount: 1,
		date: getSalesDateKey(sale.date)
	};
}

function createSalesContributionDelta(previousContribution = {}, nextContribution = {}) {
	return {
		revenue: Number(nextContribution.revenue || 0) - Number(previousContribution.revenue || 0),
		transactionCount: Number(nextContribution.transactionCount || 0) - Number(previousContribution.transactionCount || 0)
	};
}

function getSalesAnalyticsShard(uid, transactionId, shardCount = SALES_ANALYTICS_SHARD_COUNT) {
	const digest = crypto.createHash("sha256").update(`${uid}/${transactionId}`).digest();
	return String(digest.readUInt32BE(0) % shardCount).padStart(2, "0");
}

function compareSalesVersions(left = {}, right = {}) {
	const leftSeconds = Number(left.seconds || 0);
	const rightSeconds = Number(right.seconds || 0);
	if (leftSeconds !== rightSeconds) return leftSeconds - rightSeconds;
	return Number(left.nanoseconds || 0) - Number(right.nanoseconds || 0);
}

function getSalesVersion(timestamp) {
	if (timestamp && typeof timestamp.seconds !== "undefined") {
		return {
			seconds: Number(timestamp.seconds || 0),
			nanoseconds: Number(timestamp.nanoseconds || 0)
		};
	}
	const milliseconds = timestamp instanceof Date ? timestamp.getTime() : new Date(timestamp || 0).getTime();
	if (!Number.isFinite(milliseconds)) return {seconds: 0, nanoseconds: 0};
	return {
		seconds: Math.floor(milliseconds / 1000),
		nanoseconds: (milliseconds % 1000) * 1e6
	};
}

function getProductChangeSignature(product) {
	if (!product || typeof product !== "object") return null;
	const ignoredFields = new Set(["createdAt", "deviceId", "lastSyncAt", "lastSyncedAt", "syncStatus", "synced", "updatedAt"]);
	const normalize = (value, isRoot = false) => {
		if (Array.isArray(value)) return value.map(item => normalize(item));
		if (!value || typeof value !== "object") return value;
		return Object.fromEntries(Object.keys(value)
			.filter(key => !(isRoot && ignoredFields.has(key)))
			.sort()
			.map(key => [key, normalize(value[key])]));
	};
	return JSON.stringify(normalize(product, true));
}

module.exports = {
	SALES_ANALYTICS_SHARD_COUNT,
	compareSalesVersions,
	createSalesContribution,
	createSalesContributionDelta,
	getProductChangeSignature,
	getSalesAnalyticsShard,
	getSalesDateKey,
	getSalesVersion
};
