import { YIN_JIE } from '../defined/index.js';
/**
 * 检查是否可拆分。
 * 原则为拆分后的拼音前后都恰好可以组成完整的音节。
 * @param letters 拼音字母列表
 * @param markIndex 拆分标记索引（不含该索引值）
 */
const checkCanSplit = (letters, markIndex) => {
    // 后续已经没有拼音字母
    if (markIndex >= letters.length) {
        return true;
    }
    const maxIndex = Math.min(markIndex + 6, letters.length);
    let i = markIndex + 1;
    while (i <= maxIndex) {
        const part = letters.slice(markIndex, i);
        if (YIN_JIE.has(part)) {
            return true;
        }
        i++;
    }
    return false;
};
/**
 * 查找下一个所有可能的音节。
 * @param letters 拼音字母列表
 * @param start 开始索引
 * @returns 查找到下一个所有可能的音节
 */
const findNext = (letters, start = 0) => {
    if (letters.length === 0 || start >= letters.length) {
        return [];
    }
    const finalRes = [];
    const tmpRes = [];
    let i = Math.min(start + 6, letters.length);
    while (i > start) {
        const part = letters.slice(start, i);
        if (YIN_JIE.has(part)) {
            if (checkCanSplit(letters, i)) {
                finalRes.push([part, i]);
            }
            else {
                tmpRes.push([part, i]);
            }
        }
        i--;
    }
    if (finalRes.length === 0 && tmpRes.length > 0) {
        finalRes.push(tmpRes[0]);
    }
    if (finalRes.length === 0) {
        return [[letters[start], start + 1]];
    }
    return finalRes;
};
/**
 * 将拼音字母列表拆分为可能的音节列表。
 * @param letters 拼音字母列表
 * @param start 开始索引
 * @returns 拆分后的音节列表
 */
export const splitAsYinJie = (letters, start = 0) => {
    const res = [];
    findNext(letters, start).forEach(([part, markIndex]) => {
        if (markIndex < letters.length) {
            splitAsYinJie(letters, markIndex).forEach(item => {
                res.push([part, ...item]);
            });
        }
        else {
            res.push([part]);
        }
    });
    return res;
};
//# sourceMappingURL=transform.js.map