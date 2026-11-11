/** Full-page navigation away from the app (to Google's sign-in page). An object so tests can stub it. */
export const leavePage = {
  to(url: string): void {
    window.location.assign(url);
  },
};
