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
        return await this.queryWithStateRange(ctx, 'wasteDisposal', 'wasteType', wasteType);
    }

    // 按用户查询垃圾投放记录
    async queryWasteByUser(ctx, userId) {
        console.info('============= 按用户查询垃圾投放记录 ===========');
        return await this.queryWithStateRange(ctx, 'wasteDisposal', 'userId', userId);
    }

    // 使用StateRange的通用查询方法
    async queryWithStateRange(ctx, docType, fieldName, fieldValue) {
        console.info('============= 通用查询 ===========');

        const iterator = await ctx.stub.getStateByRange('', '');
        const results = [];

        while (true) {
            const res = await iterator.next();
            if (res.value && res.value.value.toString()) {
                let record;
                try {
                    record = JSON.parse(res.value.value.toString('utf8'));
                    // 在内存中过滤符合条件的记录
                    if (record.docType === docType && record[fieldName] === fieldValue) {
                        results.push(record);
                    }
                } catch (err) {
                    console.log(err);
                }
            }

            if (res.done) {
                await iterator.close();
                console.info(results);
                return JSON.stringify(results);
            }
        }
    }

    // 更新垃圾处理状态 (从投放到处理的状态变更)
    async updateWasteStatus(ctx, disposalId, newStatus, operator, remarks) {
        console.info('============= 更新垃圾处理状态 ===========');

        const disposalBytes = await ctx.stub.getState(disposalId);
        if (!disposalBytes || disposalBytes.length === 0) {
            throw new Error(`垃圾记录 ${disposalId} 不存在`);
        }

        const disposal = JSON.parse(disposalBytes.toString());
        const oldStatus = disposal.status;
        disposal.status = newStatus;

        // 记录状态变更历史
        if (!disposal.statusHistory) {
            disposal.statusHistory = [];
        }

        disposal.statusHistory.push({
            from: oldStatus,
            to: newStatus,
            operator: operator,
            timestamp: new Date().toISOString(),
            remarks: remarks
        });

        await ctx.stub.putState(disposalId, Buffer.from(JSON.stringify(disposal)));
        console.info(`垃圾记录 ${disposalId} 状态已从 ${oldStatus} 更新为 ${newStatus}`);

        return JSON.stringify(disposal);
    }

    // 用户积分转移
    async transferPoints(ctx, fromUserId, toUserId, points, remarks) {
        console.info('============= 用户积分转移 ===========');

        const pointsToTransfer = parseInt(points);
        if (pointsToTransfer <= 0) {
            throw new Error('转移积分必须大于0');
        }

        // 获取转出用户信息
        const fromUserKey = 'user_' + fromUserId;
        const fromUserBytes = await ctx.stub.getState(fromUserKey);
        if (!fromUserBytes || fromUserBytes.length === 0) {
            throw new Error(`用户 ${fromUserId} 不存在`);
        }
        const fromUser = JSON.parse(fromUserBytes.toString());

        // 检查积分是否足够
        if (parseFloat(fromUser.totalPoints) < pointsToTransfer) {
            throw new Error(`积分不足，当前积分: ${fromUser.totalPoints}, 需要: ${pointsToTransfer}`);
        }

        // 获取转入用户信息
        const toUserKey = 'user_' + toUserId;
        let toUserBytes = await ctx.stub.getState(toUserKey);
        let toUser;

        if (!toUserBytes || toUserBytes.length === 0) {
            // 如果用户不存在，创建新用户
            toUser = {
                docType: 'user',
                userId: toUserId,
                totalPoints: 0,
                wasteRecords: []
            };
        } else {
            toUser = JSON.parse(toUserBytes.toString());
        }

        // 执行积分转移
        fromUser.totalPoints = (parseFloat(fromUser.totalPoints) - pointsToTransfer).toString();
        toUser.totalPoints = (parseFloat(toUser.totalPoints) + pointsToTransfer).toString();

        // 记录交易
        const transactionId = ctx.stub.getTxID();
        const transaction = {
            docType: 'pointsTransaction',
            transactionId: transactionId,
            fromUserId: fromUserId,
            toUserId: toUserId,
            points: pointsToTransfer,
            remarks: remarks,
            timestamp: new Date().toISOString()
        };

        // 更新状态
        await ctx.stub.putState(fromUserKey, Buffer.from(JSON.stringify(fromUser)));
        await ctx.stub.putState(toUserKey, Buffer.from(JSON.stringify(toUser)));
        await ctx.stub.putState('transaction_' + transactionId, Buffer.from(JSON.stringify(transaction)));

        console.info(`用户 ${fromUserId} 转移了 ${pointsToTransfer} 积分给用户 ${toUserId}, 交易ID: ${transactionId}`);

        return JSON.stringify(transaction);
    }
}

module.exports = WasteManagementContract; 