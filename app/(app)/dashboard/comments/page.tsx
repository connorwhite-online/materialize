import { permanentRedirect } from "next/navigation";

/**
 * The inbox used to live here. It moved to /notifications so the mobile
 * nav's Notifications destination has a URL that matches its label; this
 * stays as a redirect for bookmarks and older links.
 */
export default function DashboardCommentsPage() {
  permanentRedirect("/notifications");
}
