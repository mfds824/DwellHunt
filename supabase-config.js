
import { createClient } from
  "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl =
  "https://rnbeqdffsbxjziklgtpj.supabase.co";

const supabaseKey =
  "sb_publishable_EVWodXaRyV3l1PS6-syOyA_hQoYYTpM";

export const supabase = createClient(
  supabaseUrl,
  supabaseKey
);
