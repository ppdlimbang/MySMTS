-- MySMTS: log masuk sekolah dengan emel sahaja (tanpa penghantaran emel).
--
-- Fungsi Edge "sediakan-akaun" merekodkan setiap log masuk sekolah dan
-- setiap penetapan kata laluan pentadbir dalam log_audit (jadual = 'auth').
-- Pengguna biasa (authenticated) masih tidak boleh menulis ke log_audit.

grant insert on public.log_audit to service_role;

comment on table public.log_audit is
  'Jejak audit. Perubahan jadual direkod oleh pemicu; log masuk sekolah dan penetapan kata laluan pentadbir direkod oleh fungsi Edge sediakan-akaun (jadual = auth).';
