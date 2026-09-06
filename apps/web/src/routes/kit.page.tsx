import { Tabs, TabsContent, TabsList, TabsTrigger, useTheme } from "@tj/ui";
import { useEffect } from "react";
import { Actions } from "@/components/kit/actions";
import { Choice } from "@/components/kit/choice";
import { Chrome } from "@/components/kit/chrome";
import { Content } from "@/components/kit/content";
import { Feedback } from "@/components/kit/feedback";
import { Foundations } from "@/components/kit/foundations";
import { KitFrame, KitHeader } from "@/components/kit/frame";
import { Motion } from "@/components/kit/motion";
import { Overlays } from "@/components/kit/overlays";
import { TextEntry } from "@/components/kit/text-entry";
import { Value } from "@/components/kit/value";

export function KitPage() {
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    document.title = "Kit · Teaching Journey";
  }, []);

  return (
    <>
      <div className="mx-auto max-w-[1240px] px-12 pt-10">
        <KitHeader>
          <Tabs value={theme} onValueChange={(value) => setTheme(value as typeof theme)}>
            <TabsList aria-label="Theme">
              <TabsTrigger value="light">Light</TabsTrigger>
              <TabsTrigger value="dark">Dark</TabsTrigger>
              <TabsTrigger value="high-contrast">High contrast</TabsTrigger>
              <TabsTrigger value="system">System</TabsTrigger>
            </TabsList>
            <TabsContent value="light" className="sr-only">
              Light theme selected.
            </TabsContent>
            <TabsContent value="dark" className="sr-only">
              Dark theme selected.
            </TabsContent>
            <TabsContent value="high-contrast" className="sr-only">
              High contrast theme selected.
            </TabsContent>
            <TabsContent value="system" className="sr-only">
              System theme selected.
            </TabsContent>
          </Tabs>
        </KitHeader>
      </div>
      <KitFrame>
        <Foundations />
        <Actions />
        <TextEntry />
        <Choice />
        <Value />
        <Overlays />
        <Feedback />
        <Motion />
        <Chrome />
        <Content />
      </KitFrame>
    </>
  );
}
