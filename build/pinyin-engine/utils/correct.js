import { CORRECTION_TABLE } from '../defined/index.js';
/**
 * 拼音纠错
 * @param yinJieList 音节列表
 * @returns [[原始拼音, 匹配到的拼音], ...]
 */
export const correct = (yinJieList) => {
    return yinJieList.map(item => [item, CORRECTION_TABLE.get(item) ?? item]);
};
//# sourceMappingURL=correct.js.map