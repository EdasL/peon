ALTER TABLE "chat_messages" ALTER COLUMN "project_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "user_id" uuid;
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE no action;
