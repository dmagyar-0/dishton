-- Price row for claude-haiku-5-5, the text-lane default since eval round 3
-- (eval/round-3/README.md). Without it every text-lane call would surface as
-- unpriced in metrics_ai_cost. List price for prompts <= 100K tokens (every
-- recipe import is well under that); cache read = 0.1x input, 5-minute cache
-- write = 1.25x input, matching the existing rows' convention.
insert into app.ai_model_prices
  (model, input_usd_per_mtok, output_usd_per_mtok, cache_read_usd_per_mtok, cache_write_usd_per_mtok)
values
  ('claude-haiku-5-5', 0.1000, 0.5000, 0.0100, 0.1250)
on conflict (model, effective_from) do nothing;
