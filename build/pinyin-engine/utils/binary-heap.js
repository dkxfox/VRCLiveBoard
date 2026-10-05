/**
 * 二叉堆
 *
 * 根据比较回调函数决定是最大堆还是最小堆，用法：
 * - 最小堆 new BinaryHeap<number>((a, b) => a - b);
 * - 最大堆 new BinaryHeap<number>((a, b) => b - a);
 */
export class BinaryHeap {
    data;
    compare;
    constructor(compare, data) {
        this.compare = compare;
        this.data = [];
        data?.forEach(item => this.put(item));
    }
    /**
     * 获取元素个数
     */
    getSize = () => {
        return this.data.length;
    };
    /**
     * 获取当前结点的父结点索引
     */
    getParentIndex = (i) => {
        if (i === 0) {
            throw new Error('Root element(index-0) doesn\'t has parent!');
        }
        return Math.floor((i - 1) / 2);
    };
    /**
     * 获取其左子结点的索引
     */
    getLeftChildIndex = (i) => {
        return i * 2 + 1;
    };
    /**
     * 获取其右子结点的索引
     */
    getRightChildIndex = (i) => {
        return i * 2 + 2;
    };
    /**
     * 交换两个位置上的元素
     */
    swap = (i, j) => {
        const size = this.getSize();
        if (i < 0 || j < 0 || i >= size || j >= size) {
            throw new RangeError('Index is not valid!');
        }
        const data = this.data;
        const t = data[i];
        data[i] = data[j];
        data[j] = t;
    };
    /**
     * 上浮当前元素到合适的位置
     */
    siftUp = (i) => {
        const { data, getParentIndex, compare } = this;
        while (i > 0 && compare(data[i], data[getParentIndex(i)]) < 0) {
            const parentIdx = getParentIndex(i);
            this.swap(i, parentIdx);
            i = parentIdx;
        }
    };
    /**
     * 下沉当前元素到合适的位置
     */
    siftDown = (i) => {
        const { data, getLeftChildIndex, getRightChildIndex, compare } = this;
        const size = this.getSize();
        // 如果当前结点不是叶子结点
        //（如果是叶子结点，其左子结点是不存在，另外其左子索引即使存在也将越界）
        while (getLeftChildIndex(i) < size) {
            let j = getLeftChildIndex(i);
            // 如果左子结点存在，且其右子结点与比左子结点未按照顺序排列，则更新j
            if (j + 1 < size && compare(data[j + 1], data[j]) < 0) {
                j = getRightChildIndex(i);
            }
            // 已经按照顺序排列，则中断（已经满足堆性质）
            if (compare(data[i], data[j]) <= 0) {
                break;
            }
            this.swap(i, j);
            i = j;
        }
    };
    /**
     * 向堆中添加新元素
     */
    put = (el) => {
        // 先将新元素添加到尾部
        this.data.push(el);
        // 再将该元素上浮到合适的位置
        this.siftUp(this.getSize() - 1);
    };
    /**
     * 查看当前堆顶元素
     */
    findTop = () => {
        if (this.getSize() === 0) {
            return null;
        }
        return this.data[0];
    };
    /**
     * 弹出堆顶元素
     */
    pop = () => {
        const top = this.findTop();
        if (this.getSize() > 0) {
            // 交换堆顶和堆尾元素
            this.swap(0, this.getSize() - 1);
            // 弹出“堆顶元素”
            this.data.pop();
            // 重新调整堆
            this.siftDown(0);
        }
        return top;
    };
    /**
     * 转为列表，无序的
     */
    toList = () => {
        return this.data;
    };
}
//# sourceMappingURL=binary-heap.js.map