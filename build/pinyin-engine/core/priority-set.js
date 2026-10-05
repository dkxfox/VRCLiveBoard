import { BinaryHeap } from '../utils/binary-heap.js';
/**
 * 短语
 */
export class PhraseInfo {
    /**
     * 输入的拼音
     */
    inputYinJieList;
    /**
     * 纠错后的拼音
     */
    yinJieList;
    /**
     * 短语值
     */
    phrase;
    constructor(inputYinJieList, yinJieList, phrase) {
        this.inputYinJieList = inputYinJieList;
        this.yinJieList = yinJieList;
        this.phrase = phrase;
    }
}
export class Path {
    phraseInfoList;
    score;
    constructor(phraseInfoList, score) {
        this.phraseInfoList = phraseInfoList;
        this.score = score;
    }
}
const greatThan = (a, b) => a.score - b.score;
/**
 * 优先集
 */
export class PrioritySet {
    paths = new BinaryHeap(greatThan);
    capacity;
    constructor(maxSize) {
        this.capacity = maxSize;
    }
    /**
     * 向优先集中添加一个路径
     */
    put(item) {
        this.paths.put(item);
        if (this.capacity && this.paths.getSize() > this.capacity) {
            this.paths.pop();
        }
    }
    /**
     * 获取所有路径（无序的）
     */
    getPaths = () => {
        return this.paths.toList();
    };
    /**
     * 获取所有路径（按照从大到小顺序排列）
     */
    getSortedPaths = () => {
        return this.paths.toList().slice().sort((a, b) => b.score - a.score);
    };
}
//# sourceMappingURL=priority-set.js.map