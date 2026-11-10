ALTER TABLE "deletion_batches" ADD CONSTRAINT "deletion_batches_root_chk" CHECK (("deletion_batches"."mode" in ('person', 'descendants') and "deletion_batches"."root_person_id" is not null
        and "deletion_batches"."root_union_id" is null and "deletion_batches"."root_parent_child_id" is null)
        or ("deletion_batches"."mode" = 'relation' and "deletion_batches"."root_person_id" is null
        and ("deletion_batches"."root_union_id" is null) <> ("deletion_batches"."root_parent_child_id" is null)));