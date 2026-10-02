CREATE TABLE "magic_link_sends" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "magic_link_sends_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"recipient" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "magic_link_sends_recipient_sent_at_idx" ON "magic_link_sends" USING btree ("recipient","sent_at");--> statement-breakpoint
CREATE INDEX "magic_link_sends_sent_at_idx" ON "magic_link_sends" USING btree ("sent_at");