-- InkFrame — seed data
-- Source: InkFrame_Compliance_and_Genre_Reference.md (compiled Aug 2026).
-- Re-verify periodically — platform terms change; this is a starting point,
-- not something to hard-code into application logic.

-- ============================================================================
-- platform_profiles
-- ============================================================================

insert into public.platform_profiles (
  platform_name, profile_version, last_verified, supported_languages,
  minimum_submission_words, preferred_genres,
  submission_requirements, content_rules, metadata_rules, formatting_rules,
  image_rules, contract_submission_rules, source_references, status
) values (
  'Amazon KDP', '2026-08', '2026-08-31', array['English'],
  null, array[]::text[],
  $j${
    "ai_disclosure_required_for": "AI-generated (minimal human creative input) — not AI-assisted",
    "ai_disclosure_not_required_for": ["brainstorming", "editing", "keyword research", "grammar help"],
    "record_keeping": "Keep prompts/edits/human-contribution records to support a disclosure if questioned."
  }$j$::jsonb,
  $j${
    "prohibited": [
      "harmful, offensive, or IP/privacy/publicity-infringing content",
      "copyrighted content freely available online unless rights owned",
      "misleading descriptions or inaccurate titles/covers designed to trick customers",
      "low-quality/disappointing content"
    ],
    "companion_books_need_written_permission_outside_us": true,
    "low_content_books_flagged_if": "duplicate, minimally differentiated, or mass-generated",
    "author_bears_full_legal_responsibility": true
  }$j$::jsonb,
  $j${
    "keyword_slots": 7,
    "keyword_max_chars_bytes": 50,
    "no_repeat_title_subtitle_category_words": true,
    "no_off_genre_or_trademarked_author_names": true,
    "ranking_signals": "A9 + semantic layer (COSMO) + conversational AI (Rufus) — natural-language titles rank better than keyword-stuffed ones",
    "description_guidance": "Lead with the core promise/outcome; use bold headers; crawler reads HTML structure",
    "test_keyword_sets_days": "30-60 before changing"
  }$j$::jsonb,
  '{}'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb,
  array[]::text[],
  'active'
);

insert into public.platform_profiles (
  platform_name, profile_version, last_verified, supported_languages,
  minimum_submission_words, preferred_genres,
  submission_requirements, content_rules, metadata_rules, formatting_rules,
  image_rules, contract_submission_rules, source_references, status
) values (
  'GoodNovel', '2026-08', '2026-08-31', array[]::text[],
  5000, array[]::text[],
  $j${
    "contract_application_threshold_words": 5000,
    "review_time": "2-4 weeks after application",
    "chapter_length_recommended_words": "800-1000 (soft guideline, adjustable)"
  }$j$::jsonb,
  $j${
    "disqualifying": ["copyright issues", "repetitive content", "meaningless/filler chapters"],
    "note": "Any of these can void all writer benefits."
  }$j$::jsonb,
  '{}'::jsonb,
  '{}'::jsonb,
  $j${
    "cover_restrictions": [
      "no explicit/sexual imagery",
      "no violence indicators (weapons, blood)",
      "no content promoting harmful behavior to minors (tobacco/alcohol)"
    ],
    "driven_by": "Google Play/App Store/Facebook compliance requirements"
  }$j$::jsonb,
  $j${
    "exclusive_contract": {
      "signing_bonus_requirement_words": 30000,
      "signing_bonus_deadline_days": 60,
      "signing_bonus_words_excluded_from_monthly_attendance_bonus": true
    },
    "non_exclusive_contract": {
      "reward_tier_requires_completed_on_goodnovel_first": true,
      "completion_threshold_words": 150000
    },
    "visibility_threshold_words": 50000,
    "promotion_eligibility": {
      "chapters_per_day_min": 2,
      "active_days_per_month_min": 25,
      "words_per_day_min": 2500
    }
  }$j$::jsonb,
  array[]::text[],
  'active'
);

insert into public.platform_profiles (
  platform_name, profile_version, last_verified, supported_languages,
  minimum_submission_words, preferred_genres,
  submission_requirements, content_rules, metadata_rules, formatting_rules,
  image_rules, contract_submission_rules, source_references, status
) values (
  'Meganovel', '2026-08', '2026-08-31', array[]::text[],
  null, array[]::text[],
  $j${
    "chapter_length_guideline_words": "800-1200 (up to 2000 fine, not mandatory)",
    "story_checkpoints": {
      "mc_introduced_within_words": 300,
      "first_conflict_by": "end of Chapter 1",
      "core_hook_fully_revealed_by": "Chapter 3",
      "first_climax_and_conflict_resolved_by": "Chapter 10",
      "subplots_foreshadowed_after_chapter_10_min": 3,
      "total_major_plot_twists": 3,
      "first_plot_twist_by_word_mark": 100000
    }
  }$j$::jsonb,
  '{}'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb,
  $j${
    "cover_restrictions": [
      "no overtly sexual/violent covers",
      "copyright-free images required"
    ]
  }$j$::jsonb,
  $j${
    "signing_bonus_usd": 100,
    "signing_bonus_threshold_words": 50000,
    "completion_threshold_words": 200000,
    "exclusive_prior_publication_removal_days": 30,
    "exclusive_teaser_chapters_elsewhere_allowed": true,
    "promotion_tiers": [
      "Signing Promotion (auto, at 50k words)",
      "80k words Promotion (editor-requested)",
      "Stable Updating Promotion (2 chapters/day, 25+ days/month, 2500+ words/day)"
    ]
  }$j$::jsonb,
  array[]::text[],
  'active'
);

-- ============================================================================
-- genre_taxonomy — Amazon top-level tree (KDP), expandable, not hardcoded logic
-- ============================================================================

insert into public.genre_taxonomy (genre_name, platform, last_verified, active) values
  ('Romance', 'kdp', '2026-08-31', true),
  ('Fantasy', 'kdp', '2026-08-31', true),
  ('Mystery, Thriller & Suspense', 'kdp', '2026-08-31', true),
  ('Science Fiction', 'kdp', '2026-08-31', true),
  ('Horror', 'kdp', '2026-08-31', true),
  ('Historical Fiction', 'kdp', '2026-08-31', true),
  ('Literature & Fiction', 'kdp', '2026-08-31', true),
  ('Young Adult', 'kdp', '2026-08-31', true),
  ('Children''s', 'kdp', '2026-08-31', true),
  ('Biography & Memoir', 'kdp', '2026-08-31', true),
  ('Self-Help', 'kdp', '2026-08-31', true),
  ('Business', 'kdp', '2026-08-31', true),
  ('Health & Fitness', 'kdp', '2026-08-31', true),
  ('Education', 'kdp', '2026-08-31', true),
  ('Humor', 'kdp', '2026-08-31', true),
  ('Cooking', 'kdp', '2026-08-31', true),
  ('Travel', 'kdp', '2026-08-31', true),
  ('Religion & Christian', 'kdp', '2026-08-31', true),
  ('Poetry', 'kdp', '2026-08-31', true),
  ('True Crime', 'kdp', '2026-08-31', true),
  ('Graphic Novels', 'kdp', '2026-08-31', true);

-- Subgenres with a detailed trope/structure add-on already written.
do $$
declare
  romance_id uuid;
  fantasy_id uuid;
  dark_romance_id uuid;
  contemporary_romance_id uuid;
begin
  select id into romance_id from public.genre_taxonomy where genre_name = 'Romance' and platform = 'kdp';
  select id into fantasy_id from public.genre_taxonomy where genre_name = 'Fantasy' and platform = 'kdp';

  insert into public.genre_taxonomy (genre_name, parent_genre_id, platform, last_verified, active)
    values ('Dark Romance', romance_id, 'kdp', '2026-08-31', true)
    returning id into dark_romance_id;

  insert into public.genre_taxonomy (genre_name, parent_genre_id, platform, last_verified, active)
    values ('Contemporary Romance', romance_id, 'kdp', '2026-08-31', true)
    returning id into contemporary_romance_id;

  insert into public.genre_taxonomy (genre_name, parent_genre_id, platform, has_trope_addon, addon_content, last_verified, active)
  values (
    'Mafia Romance', dark_romance_id, 'kdp', true,
    $j${
      "genre_contract": "Not a sociology lesson — a mythic-scale romance where the mafia setting supplies danger/stakes. Violence should read as evidence of devotion to the heroine's arc, not spectacle for its own sake.",
      "core_tropes": [
        "Arranged marriage — families/factions broker a marriage to settle a debt or seal an alliance; the defining trope of the genre.",
        "Enemies-to-lovers — rival families, initial resentment/distrust thawing into intensity.",
        "Forced proximity — heroine under his protection or confined for safety/control; tension precedes intimacy.",
        "Possessive-protective dynamic — the antihero's control reads as devotion, not menace, when written well."
      ],
      "stacking_guidance": "Stack 2-3 tropes, don't use all at once.",
      "structural_notes": [
        "Slow burn works naturally here — the power differential makes acting on feelings costly; that forced restraint is the engine of the tension.",
        "Heroine should never be a passive observer — her interiority must track the hero's redemption arc, not just witness it.",
        "Genre convention promises a guaranteed happy ending — readers lean into intensity because they trust the resolution."
      ]
    }$j$::jsonb,
    '2026-08-31', true
  );

  insert into public.genre_taxonomy (genre_name, parent_genre_id, platform, has_trope_addon, addon_content, last_verified, active)
  values (
    'Small Town Romance', contemporary_romance_id, 'kdp', true,
    $j${
      "trend_data_2026": [
        "Grumpy-sunshine pairing (one intense/reserved, one warm/open) is the dominant trope — pairs naturally with small-town setting.",
        "Coastal settings (New England, Pacific Northwest, Outer Banks) outsell prairie/mountain settings roughly 3:1.",
        "Forced proximity devices (snowed-in cabins, shared shop/bookstore, next-door neighbor) remain strong.",
        "Series over standalones — a 4-book series in the same town can outsell 4 standalones by an order of magnitude."
      ],
      "structural_notes": [
        "The town and its inhabitants should function as a genuine character/setting driver, not just backdrop — recurring side characters across a series is a selling point.",
        "Works well combined with 'fish out of water' (one lead new to town)."
      ]
    }$j$::jsonb,
    '2026-08-31', true
  );

  insert into public.genre_taxonomy (genre_name, parent_genre_id, platform, has_trope_addon, addon_content, last_verified, active)
  values (
    'Romantasy', fantasy_id, 'kdp', true,
    $j${
      "genre_contract": "Romance and fantasy carry equal weight — worldbuilding drives plot/conflict, romance drives emotional stakes and character growth. Neither is a subplot to the other. Roughly 35% of adult fiction bestsellers as of 2026.",
      "core_tropes": [
        "Fated mates — a bond recognized by magic/prophecy/instinct; instant high-stakes intensity plus a built-in complication.",
        "Fae courts / rival courts — heroine and a dangerous fae lord on opposing sides; the fantasy conflict supplies the obstacle for a slow-burn thaw.",
        "Morally gray love interest — powerful, dangerous, ethically complicated; the fantasy stakes make the ambiguity matter.",
        "Heroine's power/lineage discovery — an empowerment arc running parallel to and reinforcing the romance arc.",
        "Enemies-to-lovers — appears in roughly two-thirds of top romantasy titles, the single most reliable trope in the genre."
      ],
      "structural_notes": [
        "Must build a functioning magic system with real rules (academy, court hierarchy, political system) — genuine stakes, not decoration."
      ],
      "keyword_guidance": "Include specific trope tags directly (fated mates, fae romance, dragon riders, morally gray hero, enemies-to-lovers) — romantasy readers actively search by trope name."
    }$j$::jsonb,
    '2026-08-31', true
  );
end $$;
