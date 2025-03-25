'use strict';

const { Contract } = require('fabric-contract-api');

class WasteManagementContract extends Contract {

    // 初始化账本
    async initLedger(ctx) {
        console.info('============= 初始化账本 ===========');
        return;
    }

    // 记录垃圾投放
    async recordWasteDisposal(ctx, disposalId, userId, wasteType, weight, location, timestamp) {
        console.info('============= 记录垃圾投放 ===========');

        const disposal = {
            docType: 'wasteDisposal',
            userId,
            wasteType, // 可能的值: 'recyclable', 'hazardous', 'kitchen', 'other'
            weight,
            location,
            timestamp,
            status: 'recorded',
            points: this.calculatePoints(wasteType, weight)
        };

        await ctx.stub.putState(disposalId, Buffer.from(JSON.stringify(disposal)));
        console.info(`垃圾投放 ${disposalId} 已记录`);

        // 更新用户积分
        await this.updateUserPoints(ctx, userId, disposal.points);

        return JSON.stringify(disposal);
    }

    // 计算积分
    calculatePoints(wasteType, weight) {
        const weightNum = parseFloat(weight);
        switch (wasteType) {
            case 'recyclable':
                return weightNum * 2;
            case 'hazardous':
                return weightNum * 3;
            case 'kitchen':
                return weightNum * 1;
            default:
                return weightNum * 0.5;
        }
    }

    // 更新用户积分
    async updateUserPoints(ctx, userId, pointsToAdd) {
        const userKey = 'user_' + userId;
        let userBytes = await ctx.stub.getState(userKey);
        let user;

        if (!userBytes || userBytes.length === 0) {
            user = {
                docType: 'user',
                userId: userId,
                totalPoints: 0,
                wasteRecords: []
            };
        } else {
            user = JSON.parse(userBytes.toString());
        }

        user.totalPoints = (parseFloat(user.totalPoints) + parseFloat(pointsToAdd)).toString();
        await ctx.stub.putState(userKey, Buffer.from(JSON.stringify(user)));
        console.info(`用户 ${userId} 积分更新为 ${user.totalPoints}`);
    }

    // 获取垃圾投放记录
    async getWasteDisposal(ctx, disposalId) {
        const disposalBytes = await ctx.stub.getState(disposalId);
        if (!disposalBytes || disposalBytes.length === 0) {
            throw new Error(`垃圾投放记录 ${disposalId} 不存在`);
        }
        console.info('============= 获取垃圾投放记录 ===========');
        return disposalBytes.toString();
    }

    // 获取用户信息
    async getUser(ctx, userId) {
        const userKey = 'user_' + userId;
        const userBytes = await ctx.stub.getState(userKey);
        if (!userBytes || userBytes.length === 0) {
            throw new Error(`用户 ${userId} 不存在`);
        }
        console.info('============= 获取用户信息 ===========');
        return userBytes.toString();
    }

    // 查询垃圾处理记录历史
    async getWasteDisposalHistory(ctx, disposalId) {
        console.info('============= 获取垃圾投放历史 ===========');

        const iterator = await ctx.stub.getHistoryForKey(disposalId);
        const results = [];

        while (true) {
            const res = await iterator.next();
            if (res.value && res.value.value.toString()) {
                console.log(res.value.value.toString());
                let record;
                try {
                    record = JSON.parse(res.value.value.toString('utf8'));
                } catch (err) {
                    console.log(err);
                    record = res.value.value.toString('utf8');
                }
                results.push({ TxId: res.value.tx_id, Timestamp: res.value.timestamp, Record: record });
            }

            if (res.done) {
                await iterator.close();
                console.info(results);
                return JSON.stringify(results);
            }
        }
    }

    // 按类型查询垃圾统计
    async queryWasteByType(ctx, wasteType) {
        console.info('============= 按类型查询垃圾统计 ===========');

        const queryString = {
            selector: {
                docType: 'wasteDisposal',
                wasteType: wasteType
            }
        };

        return await this.queryWithQueryString(ctx, JSON.stringify(queryString));
    }

    // 按用户查询垃圾投放记录
    async queryWasteByUser(ctx, userId) {
        console.info('============= 按用户查询垃圾投放记录 ===========');

        const queryString = {
            selector: {
                docType: 'wasteDisposal',
                userId: userId
            }
        };

        return await this.queryWithQueryString(ctx, JSON.stringify(queryString));
    }

    // 通用查询方法
    async queryWithQueryString(ctx, queryString) {
        console.info('============= 通用查询 ===========');

        const iterator = await ctx.stub.getQueryResult(queryString);
        const results = [];

        while (true) {
            const res = await iterator.next();
            if (res.value && res.value.value.toString()) {
                console.log(res.value.value.toString());
                let record;
                try {
                    record = JSON.parse(res.value.value.toString('utf8'));
                } catch (err) {
                    console.log(err);
                    record = res.value.value.toString('utf8');
                }
                results.push(record);
            }

            if (res.done) {
                await iterator.close();
                console.info(results);
                return JSON.stringify(results);
            }
        }
    }
}

module.exports = WasteManagementContract; 