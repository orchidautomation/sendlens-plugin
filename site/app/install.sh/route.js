const INSTALLER_URL =
  "https://github.com/orchidautomation/sendlens-plugin/releases/latest/download/install.sh";

export function GET() {
  return Response.redirect(INSTALLER_URL, 307);
}
