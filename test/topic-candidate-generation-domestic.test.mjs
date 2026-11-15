import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTopicCandidates } from '../server/features/research/domain/topic-candidate-generation.mjs';

test('multi-event candidate inherits domestic relevance from its lead event', () => {
  const events = [
    { event_id: 'E1', representative_title: '事件一', topic_category: '产品与技术动态', china_relevance_score: 2, articles: [] },
    { event_id: 'E2', representative_title: '事件二', topic_category: '产品与技术动态', china_relevance_score: 11, articles: [] },
  ];
  const ranking = [
    { eventId: 'E1', eventHeatRank: 2, eventValue: 80, chinaRelevance: 2 },
    { eventId: 'E2', eventHeatRank: 1, eventValue: 75, chinaRelevance: 11 },
  ];
  const candidates = buildTopicCandidates({ events, ranking, discussionResearch: {
    research_source: 'model',
    scope: { items: events.map((event, index) => ({ event_id: event.event_id, selection_rank: index + 1 })) },
    topic_candidates: [{ candidate_id: 'joined', topic_type: 'event_comparison', event_ids: ['E1', 'E2'],
      candidate_title: '事件一与事件二的变化', core_question: '差异在哪？' }],
  } });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].chinaRelevance, 11);
});
