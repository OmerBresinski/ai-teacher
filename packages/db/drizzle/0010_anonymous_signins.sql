CREATE TABLE "anonymous_signins" (
	"ip" text NOT NULL,
	"day" date NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "anonymous_signins_ip_day_pk" PRIMARY KEY("ip","day")
);
