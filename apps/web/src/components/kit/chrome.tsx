import {
  AppBar,
  AppBarGroup,
  AppBarTitle,
  Button,
  Display,
  ListSurface,
  ListSurfaceCell,
  ListSurfaceHeader,
  ListSurfaceRow,
  Sidebar,
  SidebarItem,
} from "@tj/ui";
import { FileText, House, Presentation } from "lucide-react";
import { useState } from "react";
import { KitGroup, Specimen, Variant } from "./frame";

export function Chrome() {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <KitGroup id="chrome" title="Chrome">
      <Specimen name="AppBar" bleed>
        <div className="w-full overflow-hidden rounded-card border border-border">
          <AppBar>
            <AppBarGroup>
              <AppBarTitle>Lesson title</AppBarTitle>
            </AppBarGroup>
            <AppBarGroup className="ml-auto">
              <Button size="sm">Present</Button>
            </AppBarGroup>
          </AppBar>
        </div>
      </Specimen>
      <Specimen name="AppBar, maxWidth" bleed>
        <div className="w-full overflow-hidden rounded-card border border-border">
          <AppBar maxWidth={480}>
            <AppBarGroup>
              <AppBarTitle>Max width</AppBarTitle>
            </AppBarGroup>
          </AppBar>
        </div>
      </Specimen>
      <Specimen name="Sidebar, expanded and collapsed" bleed>
        <div className="flex flex-wrap gap-6">
          <Variant label="Expanded 320px">
            <div className="h-80 overflow-hidden rounded-card border border-border">
              <Sidebar
                className="relative h-full"
                aria-label="Kit sidebar"
                collapsed={collapsed}
                onCollapsedChange={setCollapsed}
                wordmark={
                  <Display as="span" size="md">
                    TeachDeck
                  </Display>
                }
                mark={
                  <Display as="span" size="md">
                    T
                  </Display>
                }
                foot={<SidebarItem icon={<FileText aria-hidden />}>Import</SidebarItem>}
              >
                <SidebarItem icon={<House aria-hidden />} active>
                  Home
                </SidebarItem>
                <SidebarItem icon={<Presentation aria-hidden />}>Lessons</SidebarItem>
              </Sidebar>
            </div>
          </Variant>
          <Variant label="Collapsed 320px">
            <div className="h-80 overflow-hidden rounded-card border border-border">
              <Sidebar
                className="relative h-full"
                aria-label="Collapsed kit sidebar"
                collapsed
                mark={
                  <Display as="span" size="md">
                    T
                  </Display>
                }
              >
                <SidebarItem icon={<House aria-hidden />}>Home</SidebarItem>
              </Sidebar>
            </div>
          </Variant>
        </div>
      </Specimen>
      <Specimen name="ListSurface, header and rows" bleed>
        <ListSurface
          aria-label="Kit list"
          header={
            <ListSurfaceHeader>
              <ListSurfaceCell header>Title</ListSurfaceCell>
              <ListSurfaceCell header>Type</ListSurfaceCell>
            </ListSurfaceHeader>
          }
        >
          <ListSurfaceRow>
            <ListSurfaceCell>Fractions</ListSurfaceCell>
            <ListSurfaceCell>Lesson</ListSurfaceCell>
          </ListSurfaceRow>
          <ListSurfaceRow>
            <ListSurfaceCell>Water cycle</ListSurfaceCell>
            <ListSurfaceCell>Worksheet</ListSurfaceCell>
          </ListSurfaceRow>
        </ListSurface>
      </Specimen>
    </KitGroup>
  );
}
