import { correct } from '../utils/correct.js';
import { Path, PhraseInfo, PrioritySet } from './priority-set.js';
/**
 * 有向无环图（DAG）
 */
export class DirectedAcyclicGraph {
    charDict;
    phraseDict;
    constructor(charDict, phraseDict) {
        this.charDict = charDict;
        this.phraseDict = phraseDict;
    }
    setCharDict = (charDict) => {
        this.charDict = charDict;
    };
    setPhraseDict = (phraseDict) => {
        this.phraseDict = phraseDict;
    };
    queryPhraseScoreInfo = (yinJieList, num) => {
        if (yinJieList.length === 0) {
            return [];
        }
        const dict = yinJieList.length === 1 ? this.charDict : this.phraseDict;
        const index = yinJieList.join(',');
        const wordList = dict[index];
        if (wordList && num) {
            return wordList.slice(0, num);
        }
        return wordList ?? [];
    };
    query = ({ yinJieList, maxNum, log = false }) => {
        if (!yinJieList.length) {
            return [];
        }
        // 纠错
        const correctedYinJieList = correct(yinJieList);
        const total = correctedYinJieList.length;
        const dp = new Array(total);
        for (let i = 0; i < total; i++) {
            dp[i] = new PrioritySet(maxNum);
        }
        for (let fromIndex = 0; fromIndex < 1; fromIndex++) {
            for (let toIndex = fromIndex; toIndex < total; toIndex++) {
                const tempYinJieList = correctedYinJieList.slice(fromIndex, toIndex + 1);
                const inputYinJieList = tempYinJieList.map(item => item[0]);
                const yinJieList = tempYinJieList.map(item => item[1]);
                const phraseScoreInfoList = this.queryPhraseScoreInfo(yinJieList, maxNum);
                phraseScoreInfoList.forEach(([phrase, score]) => {
                    const path = new Path([
                        new PhraseInfo(inputYinJieList, yinJieList, phrase)
                    ], log ? Math.log(score) : score);
                    dp[toIndex].put(path);
                });
            }
        }
        for (let fromIndex = 1; fromIndex < total; fromIndex++) {
            const prevPaths = dp[fromIndex - 1].getPaths();
            for (let toIndex = fromIndex; toIndex < total; toIndex++) {
                const tempYinJieList = correctedYinJieList.slice(fromIndex, toIndex + 1);
                const inputYinJieList = tempYinJieList.map(item => item[0]);
                const yinJieList = tempYinJieList.map(item => item[1]);
                const phraseScoreInfoList = this.queryPhraseScoreInfo(yinJieList, maxNum);
                prevPaths.forEach(prevPath => {
                    phraseScoreInfoList.forEach(([phrase, score]) => {
                        const newValue = [...prevPath.phraseInfoList];
                        newValue.push(new PhraseInfo(inputYinJieList, yinJieList, phrase));
                        const newScore = log ? Math.log(score) + prevPath.score : score * prevPath.score;
                        const path = new Path(newValue, newScore);
                        dp[toIndex].put(path);
                    });
                });
            }
        }
        return dp.at(-1)?.getSortedPaths() ?? [];
    };
}
//# sourceMappingURL=dag.js.map