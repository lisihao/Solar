-- 清理 company 团队的孤儿成员行 + 悬空 leader/ceo 引用
--
-- 根因：company_team_members.hired_agent_id 是松散字符串，无 FK 级联。
-- 解雇/移除 Agent（deleteHired 只删 company_hired_agents）后，引用它的成员行、
-- 团队 leader_id、公司 ceo_hired_agent_id 都没被清理 → 团队成员数虚高、
-- 组织架构因 leader 解析不到而整个团队隐身。
--
-- 代码侧已修：deleteHired 现在在事务里级联清理。本迁移清掉历史遗留的孤儿数据。
-- 幂等：DELETE / UPDATE ... WHERE NOT IN 可重复执行。

DELETE FROM company_team_members
WHERE hired_agent_id NOT IN (SELECT id FROM company_hired_agents);

UPDATE company_teams
SET leader_id = NULL
WHERE leader_id IS NOT NULL
  AND leader_id NOT IN (SELECT id FROM company_hired_agents);

UPDATE company_profiles
SET ceo_hired_agent_id = NULL
WHERE ceo_hired_agent_id IS NOT NULL
  AND ceo_hired_agent_id NOT IN (SELECT id FROM company_hired_agents);
