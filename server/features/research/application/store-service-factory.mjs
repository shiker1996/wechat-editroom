import { CandidateSelectionService } from './candidate-selection-service.mjs';

// 研究垂直负责把自己的候选选择用例装配给平台 Store；平台只接收抽象工厂，不依赖 research。
export function createCandidateSelectionService(db, repositories, candidateQueries) {
  return new CandidateSelectionService(db, repositories, candidateQueries);
}
