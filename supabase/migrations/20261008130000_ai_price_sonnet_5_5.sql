-- Price row for claude-sonnet-5-5, the vision-lane default since eval round 3
-- (eval/round-3/README.md). Without it every photo import would surface as
-- unpriced in metrics_ai_cost. List price; cache read = 0.1x input, 5-minute
-- cache write = 1.25x input, matching the existing rows' convention.
insert into app.ai_model_prices
  (model, input_usd_per_mtok, output_usd_per_mtok, cache_read_usd_per_mtok, cache_write_usd_per_mtok)
values
  ('claude-sonnet-5-5', 2.0000, 10.0000, 0.2000, 2.5000)
on conflict (model, effective_from) do nothing;
