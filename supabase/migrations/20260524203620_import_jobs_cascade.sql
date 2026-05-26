-- Make app.import_jobs.household_id cascade on household delete.
--
-- Every other FK referencing app.households(id) (recipes, household_members,
-- household_invites, follows, household_follow_codes) is ON DELETE CASCADE.
-- import_jobs was the lone NO ACTION constraint. When app.redeem_invite ends
-- with `delete from app.households where id = src_hh` for a solo redeemer who
-- has ever run an import, the orphan import_jobs row blocks the delete and
-- rolls back the whole redeem transaction. An import-job log row is only
-- meaningful as long as its household exists, so cascading is the right
-- semantics.

alter table app.import_jobs
  drop constraint import_jobs_household_id_fkey,
  add constraint import_jobs_household_id_fkey
    foreign key (household_id) references app.households(id) on delete cascade;
