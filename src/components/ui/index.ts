// Primitives du système de design v2 — spec: specs/design-system-v2-raycast.md § 5.
// Une page compose ces primitives (et les sections, les archétypes) ; elle n'écrit ni couleur,
// ni taille, ni classe de recette (`btn`, `card`…) à la main.
export { Button, buttonClass, buttonVariants } from "./Button";
export { Avatar, Badge, Card, Divider, Eyebrow, IconCircle, Kbd, Keycap, MetaRow, MonoMeta, Skeleton, Switch } from "./primitives";
export { ActionBar, ListRow, type Action } from "./command";
export { Toast, Tooltip } from "./feedback";
export { Chip, ChipLink, SearchField } from "./form";
export { SegmentedControl as Tabs } from "@/components/SegmentedControl";
export { FilterSelect as Select } from "@/components/FilterSelect";
export { ConfirmDialog } from "@/components/ConfirmDialog";
