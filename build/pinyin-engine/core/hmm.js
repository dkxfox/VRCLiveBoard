import { correct } from '../utils/correct.js';
import { Path, PhraseInfo, PrioritySet } from './priority-set.js';
/**
 * 隐马尔可夫模型（HMM）
 */
export class HiddenMarkovModel {
    pinyinDict;
    startDict;
    emissionDict;
    transitionDict;
    constructor(pinyinDict, startDict, emissionDict, transitionDict) {
        this.pinyinDict = pinyinDict;
        this.startDict = startDict;
        this.emissionDict = emissionDict;
        this.transitionDict = transitionDict;
    }
    setPinyinDict = (pinyinDict) => {
        this.pinyinDict = pinyinDict;
    };
    setStartDict = (startDict) => {
        this.startDict = startDict;
    };
    setEmissionDict = (emissionDict) => {
        this.emissionDict = emissionDict;
    };
    setTransitionDict = (transitionDict) => {
        this.transitionDict = transitionDict;
    };
    start = (state) => {
        return this.startDict.data[state] ?? this.startDict.default;
    };
    emission = (state, observation) => {
        return this.emissionDict.data[state]?.[observation] ?? this.emissionDict.default;
    };
    transition = (fromState, toState) => {
        const prodDict = this.transitionDict.data[fromState];
        if (prodDict) {
            return prodDict[toState] ?? prodDict['default'] ?? this.transitionDict.default;
        }
        return this.transitionDict.default;
    };
    getStates = (observation) => {
        return this.pinyinDict[observation]?.split('') ?? [];
    };
    query = ({ yinJieList, maxNum, log = false, minProb = 3.14e-200 }) => {
        if (!yinJieList.length) {
            return [];
        }
        // 纠错
        const correctedYinJieList = correct(yinJieList);
        const total = correctedYinJieList.length;
        let dp = [new Map()];
        let curObs = correctedYinJieList[0];
        let prevStates = this.getStates(curObs[1]);
        let curStates = prevStates;
        curStates.forEach(curState => {
            const startScore = Math.max(this.start(curState), minProb);
            const emissionScore = Math.max(this.emission(curState, curObs[1]), minProb);
            const score = log ? Math.log(startScore) + Math.log(emissionScore) : startScore * emissionScore;
            const prioritySet = dp[0].get(curState) ?? new PrioritySet(maxNum);
            prioritySet.put(new Path([
                new PhraseInfo([curObs[0]], [curObs[1]], curState)
            ], score));
            dp[0].set(curState, prioritySet);
        });
        for (let i = 1; i < total; i++) {
            curObs = correctedYinJieList[i];
            if (dp.length === 2) {
                dp = [dp.at(-1)];
            }
            dp.push(new Map());
            prevStates = curStates;
            curStates = this.getStates(curObs[1]);
            curStates.forEach(curState => {
                if (!dp[1].has(curState)) {
                    dp[1].set(curState, new PrioritySet(maxNum));
                }
                prevStates.forEach(prevState => {
                    const prevSet = dp[0].get(prevState);
                    if (prevSet) {
                        prevSet.getPaths().forEach(path => {
                            const transitionScore = Math.max(this.transition(prevState, curState), minProb);
                            const emissionScore = Math.max(this.emission(curState, curObs[1]), minProb);
                            const score = log ? path.score + Math.log(transitionScore) + Math.log(emissionScore) : path.score * transitionScore * emissionScore;
                            dp[1].get(curState)?.put(new Path([
                                ...path.phraseInfoList,
                                new PhraseInfo([curObs[0]], [curObs[1]], curState)
                            ], score));
                        });
                    }
                });
            });
        }
        const result = new PrioritySet(maxNum);
        dp.at(-1)?.forEach(lastSet => {
            lastSet.getPaths().forEach(item => {
                result.put(new Path(item.phraseInfoList, item.score));
            });
        });
        return result.getSortedPaths();
    };
}
//# sourceMappingURL=hmm.js.map