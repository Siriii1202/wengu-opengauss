import { complete, createRecord, today } from '../lib/review.mjs';

const examples = [
  ['gauss-join', 'SQL 连接查询与外键约束', '数据库系统原理', 0, '1d,3d,7d,14d', '对比 INNER JOIN 和 LEFT JOIN，查出尚未安排复习任务的学习记录。'],
  ['tree-traversal', '二叉树的前序、中序与后序遍历', '数据结构', 1, '1d,3d,7d,14d,1m', '用同一棵树写出三种遍历结果，再手写一次非递归中序。'],
  ['matrix-rank', '矩阵的秩与线性方程组解的判定', '线性代数', 2, '1d,3d,7d,14d,1m', '比较系数矩阵与增广矩阵的秩，分别举出无解、唯一解、无穷多解的例子。'],
  ['page-replacement', 'FIFO 与 LRU 页面置换', '操作系统', 7, '7d,14d,1m,3m', '用三个页框手算引用序列，比较两种算法的缺页次数。'],
  ['tcp-window', 'TCP 滑动窗口与流量控制', '计算机网络', 3, '1d,7d,14d,1m', '区分接收窗口和拥塞窗口，解释接收窗口为零时的处理。', 0, 'vague'],
  ['derivative', '复合函数求导与链式法则', '高等数学', 4, '1d,7d,14d,1m', '从外到内标出各层函数，重做一道多层复合函数求导题。', 3, 'solid'],
];

export function exampleRecords() {
  const day = today();
  function daysAgo(days) {
    const date = new Date(day + 'T12:00:00Z');
    date.setUTCDate(date.getUTCDate() - days);
    return date.toISOString().slice(0, 10);
  }

  return examples.map(([key, title, subject, age, cycle, note, reviewedAge, effect]) => {
    const record = createRecord({ title, subject, date: daysAgo(age), cycle, note: '示例记录。' + note });
    record.id = 'example-' + key;
    if (reviewedAge !== undefined) {
      const reviewDate = daysAgo(reviewedAge);
      const event = complete(record, reviewDate, effect);
      event.createdAt = reviewDate + 'T04:00:00.000Z';
    }
    return record;
  });
}
