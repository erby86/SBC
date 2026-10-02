-- Source: sbc-noc-schema-v1.1.sql (design v1.2, 2026-09-29). Applied verbatim; do not edit after release — add a new migration instead.
-- sbc_noc schema v1.1 (ร่างสำหรับทบทวน ยังไม่ได้รันจริง)
-- PostgreSQL 16, container sbc-noc-db, database sbc_noc
-- v1.1 เพิ่มจาก v1: ชั้นกายภาพ (rack, สายและแกนไฟเบอร์, จุด LAN, SFP, ไฟฟ้า/UPS),
--   ลอจิคัล (VLAN ต่อพอร์ต, LACP, SSID, controller ที่ดูแล), วงจรชีวิตและสัญญา (ประกัน, ผู้ขาย, ISP SLA),
--   ปฏิบัติการ (ประวัติเหตุระยะยาว, งานเปลี่ยนแปลง, เวร, กติกาแจ้งเตือน, คู่มือ, ความพร้อมใช้รายเดือน, ปฏิทินโรงเรียน),
--   เอกสารแนบ, ตรวจสอบข้อมูล (verified, LLDP), หน้าจอ (ตำแหน่งห้อง, ชื่อเรียกอื่น, ค่าส่วนตัว, จอทีวี),
--   integration (API client), กันแก้ชนกัน (row_version), บันทึกการกระทำผู้ใช้
-- กติกา: รหัสที่คนอ่านได้ (code, loc_code) ไม่นำกลับมาใช้ซ้ำแม้ลบแล้ว, ไม่เก็บรหัสผ่าน/secret ในฐาน (เก็บแค่ secret_ref)

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE SCHEMA IF NOT EXISTS core;     -- สถานที่ บุคลากร องค์กร เอกสาร ปฏิทิน ระบบภายนอก
CREATE SCHEMA IF NOT EXISTS catalog;  -- บทบาท รุ่น
CREATE SCHEMA IF NOT EXISTS asset;    -- ครุภัณฑ์ทุกชนิด
CREATE SCHEMA IF NOT EXISTS net;      -- เครือข่าย กายภาพ + ลอจิคัล
CREATE SCHEMA IF NOT EXISTS viz;      -- ผัง 3D และจอแสดงผล
CREATE SCHEMA IF NOT EXISTS auth;     -- ผู้ใช้ บทบาท API client
CREATE SCHEMA IF NOT EXISTS ops;      -- ปฏิบัติการ เหตุ งานเปลี่ยนแปลง เวร แจ้งเตือน
CREATE SCHEMA IF NOT EXISTS sync;     -- งานซิงก์ การค้นพบ
CREATE SCHEMA IF NOT EXISTS audit;    -- ประวัติการแก้ไขและการกระทำ
CREATE SCHEMA IF NOT EXISTS api;      -- view สำหรับระบบอื่น

-- ---------- ฟังก์ชันกลาง ----------
CREATE OR REPLACE FUNCTION core.touch_row() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  NEW.row_version := OLD.row_version + 1;      -- หน้าจัดการส่ง row_version เดิมมา ถ้าไม่ตรงแปลว่ามีคนแก้ก่อน
  RETURN NEW;
END $$;

-- ================= core =================
CREATE TABLE core.source_systems (
  code      text PRIMARY KEY,                  -- noc, zabbix, glpi, sbc_asset, sbc_portal, unifi, omada, link_ap, gsheet_seed, lldp
  name      text NOT NULL,
  base_url  text,
  notes     text
);

CREATE TABLE core.organizations (              -- ISP, ผู้ผลิต, ผู้ขาย, ผู้รับเหมา
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,            -- nt, 3bb, true, ais, mikrotik, tplink, ubiquiti, link, hikvision
  name        text NOT NULL,
  kinds       text[] NOT NULL DEFAULT '{}',    -- {isp}, {vendor}, {supplier}, {contractor}
  website     text,
  notes       text,
  attributes  jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  row_version integer NOT NULL DEFAULT 1,
  deleted_at  timestamptz
);

CREATE TABLE core.contacts (                   -- ผู้ติดต่อภายนอก (ฝ่ายขาย, support, hotline ISP)
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
  name        text NOT NULL,
  role        text,                            -- support, sales, noc_hotline, technician
  phone       text,
  email       text,
  line_id     text,
  notes       text,
  active      boolean NOT NULL DEFAULT true
);

CREATE TABLE core.staff (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_code  text NOT NULL UNIQUE,            -- STF-01..STF-07
  full_name   text NOT NULL,
  email       text UNIQUE,
  phone       text,                            -- ใช้กับเวร/แจ้งเตือน (เก็บเท่าที่จำเป็น)
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  row_version integer NOT NULL DEFAULT 1
);

CREATE TABLE core.sites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,            -- sbc
  name        text NOT NULL,
  timezone    text NOT NULL DEFAULT 'Asia/Bangkok',
  attributes  jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  row_version integer NOT NULL DEFAULT 1,
  deleted_at  timestamptz
);

CREATE TABLE core.building_forms (code text PRIMARY KEY, name text NOT NULL);

CREATE TABLE core.buildings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id         uuid NOT NULL REFERENCES core.sites(id),
  code            text NOT NULL,               -- sp, i2, i1, b1, b2, s8, ba, bb
  name            text NOT NULL,
  name_en         text,
  aliases         text[] NOT NULL DEFAULT '{}',-- ใช้ค้นหา: {อ.1, ตึก1, b1}, {sport, ยิม}
  asset_name      text,                        -- ชื่อใน SBC ASSET
  form_code       text REFERENCES core.building_forms(code),
  floor_count     smallint NOT NULL CHECK (floor_count >= 0),
  rooms_per_floor smallint,
  has_network     boolean NOT NULL DEFAULT true,
  attributes      jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  row_version     integer NOT NULL DEFAULT 1,
  deleted_at      timestamptz,
  UNIQUE (site_id, code)
);

CREATE TABLE core.floors (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id  uuid NOT NULL REFERENCES core.buildings(id) ON DELETE CASCADE,
  level        smallint NOT NULL,
  name         text,
  UNIQUE (building_id, level)
);

CREATE TABLE core.location_types (code text PRIMARY KEY, name text NOT NULL);

CREATE SEQUENCE core.loc_code_seq START WITH 188;   -- LOC-001..186 จาก SBC ASSET, LOC-187 = ห้อง server

CREATE TABLE core.locations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loc_code        text NOT NULL UNIQUE,
  floor_id        uuid NOT NULL REFERENCES core.floors(id),
  name            text NOT NULL,
  name_en         text,
  room_number     text,                        -- เลขห้องที่ติดหน้าห้อง เช่น 2310, C203
  type_code       text REFERENCES core.location_types(code),
  corridor_order  smallint,
  side            text,                        -- ฝั่งของทางเดิน: north, south, east, west, inner, outer
  has_rack        boolean NOT NULL DEFAULT false,
  owner_system    text NOT NULL REFERENCES core.source_systems(code),
  verified_at     timestamptz,                 -- ตรวจหน้างานแล้วเมื่อไร
  verified_by     uuid REFERENCES core.staff(id),
  attributes      jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  row_version     integer NOT NULL DEFAULT 1,
  deleted_at      timestamptz
);
CREATE INDEX locations_name_trgm ON core.locations USING gin (name gin_trgm_ops);

CREATE OR REPLACE FUNCTION core.next_loc_code() RETURNS text LANGUAGE sql AS $$
  SELECT 'LOC-' || lpad(nextval('core.loc_code_seq')::text, 3, '0') $$;

CREATE TABLE core.location_metrics (
  location_id  uuid NOT NULL REFERENCES core.locations(id) ON DELETE CASCADE,
  metric       text NOT NULL,                  -- registry_pc_count, pc_online, lan_outlets, ap_count
  value        numeric NOT NULL,
  source       text NOT NULL REFERENCES core.source_systems(code),
  as_of        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (location_id, metric, source)
);

CREATE TABLE core.external_refs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_table  text NOT NULL,
  entity_id     uuid NOT NULL,
  system_code   text NOT NULL REFERENCES core.source_systems(code),
  external_id   text NOT NULL,
  external_key  text,
  url           text,
  last_seen_at  timestamptz,
  UNIQUE (system_code, entity_table, external_id),
  UNIQUE (entity_table, entity_id, system_code)
);

CREATE TABLE core.tags (id serial PRIMARY KEY, name text NOT NULL UNIQUE);
CREATE TABLE core.entity_tags (
  entity_table text NOT NULL, entity_id uuid NOT NULL,
  tag_id integer NOT NULL REFERENCES core.tags(id) ON DELETE CASCADE,
  PRIMARY KEY (entity_table, entity_id, tag_id)
);

CREATE TABLE core.attachments (                -- รูปตู้ rack, ผังชั้น, แบบแปลนไฟเบอร์, ใบรับประกัน (ไฟล์อยู่ใน Drive/ที่เก็บไฟล์)
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_table  text NOT NULL,
  entity_id     uuid NOT NULL,
  kind          text NOT NULL,                 -- photo, floor_plan, fiber_plan, warranty, manual, report
  title         text NOT NULL,
  url           text NOT NULL,
  drive_file_id text,
  mime_type     text,
  uploaded_by   uuid REFERENCES core.staff(id),
  uploaded_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attachments_entity ON core.attachments (entity_table, entity_id);

CREATE TABLE core.calendar_events (            -- เวลาเรียน วันหยุด ช่วงสอบ ใช้กับโหมดนอกเวลาเรียน/กติกาแจ้งเตือน
  id          serial PRIMARY KEY,
  site_id     uuid NOT NULL REFERENCES core.sites(id),
  kind        text NOT NULL,                   -- school_hours, holiday, exam, event
  name        text NOT NULL,
  starts_at   timestamptz,
  ends_at     timestamptz,
  rrule       text,                            -- เช่น FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR สำหรับเวลาเรียนประจำ
  time_start  time,
  time_end    time
);

-- ================= catalog =================
CREATE TABLE catalog.device_roles (code text PRIMARY KEY, name text NOT NULL, layer text NOT NULL, monitored boolean NOT NULL DEFAULT true);
CREATE TABLE catalog.models (
  id             serial PRIMARY KEY,
  vendor_org_id  uuid REFERENCES core.organizations(id),
  name           text NOT NULL,
  kind           text NOT NULL,                -- router, switch, ap, nvr, controller, ups, patch_panel, sfp, pc, printer
  port_count     smallint,
  poe_budget_w   smallint,
  eol_date       date,                         -- วันสิ้นสุดการสนับสนุนจากผู้ผลิต
  datasheet_url  text,
  specs          jsonb NOT NULL DEFAULT '{}',
  UNIQUE (vendor_org_id, name)
);

-- ================= asset =================
CREATE TABLE asset.assets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_tag       text UNIQUE,                 -- เลขครุภัณฑ์
  sba_code        text UNIQUE,                 -- รหัส SBC ASSET
  category        text NOT NULL,               -- network, computer, printer, cctv, power
  model_id        integer REFERENCES catalog.models(id),
  serial_no       text,
  location_id     uuid REFERENCES core.locations(id),
  status          text NOT NULL DEFAULT 'in_use',
  purchase_date   date,
  po_number       text,
  supplier_org_id uuid REFERENCES core.organizations(id),
  warranty_until  date,
  attributes      jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  row_version     integer NOT NULL DEFAULT 1,
  deleted_at      timestamptz
);

-- ================= net: ลอจิคัลพื้นฐาน =================
CREATE TABLE net.vlans (
  id       serial PRIMARY KEY,
  vid      smallint NOT NULL UNIQUE CHECK (vid BETWEEN 1 AND 4094),
  name     text NOT NULL,
  purpose  text,
  planned  boolean NOT NULL DEFAULT false
);

CREATE TABLE net.subnets (
  id                     serial PRIMARY KEY,
  cidr                   cidr NOT NULL UNIQUE,
  vlan_id                integer REFERENCES net.vlans(id),
  gateway                inet,
  dhcp_server_device_id  uuid,                 -- FK เพิ่มหลังสร้าง net.devices
  dhcp_start             inet,
  dhcp_end               inet,
  notes                  text
);

-- ================= net: กายภาพ =================
CREATE TABLE net.racks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text NOT NULL UNIQUE,           -- RK-B2-SRV-01
  location_id  uuid NOT NULL REFERENCES core.locations(id),
  u_height     smallint NOT NULL DEFAULT 42,
  kind         text NOT NULL DEFAULT 'rack',   -- rack, wall_cabinet, open_frame
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  row_version  integer NOT NULL DEFAULT 1,
  deleted_at   timestamptz
);

CREATE TABLE net.devices (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                   text NOT NULL UNIQUE, -- c2116, m-s8, ap-s8-6-1 (ไม่นำกลับมาใช้ซ้ำ)
  display_name           text NOT NULL,
  hostname               text,                 -- ชื่อ host ในอุปกรณ์/ Zabbix
  role_code              text NOT NULL REFERENCES catalog.device_roles(code),
  model_id               integer REFERENCES catalog.models(id),
  asset_id               uuid UNIQUE REFERENCES asset.assets(id),
  location_id            uuid REFERENCES core.locations(id),
  floor_id               uuid REFERENCES core.floors(id),
  rack_id                uuid REFERENCES net.racks(id),
  rack_u_start           smallint,
  rack_u_size            smallint,
  managed_by_device_id   uuid REFERENCES net.devices(id),   -- AP → controller (UniFi/Omada/LINK)
  power_source_device_id uuid REFERENCES net.devices(id),   -- ต่อ UPS ตัวไหน
  poe_powered            boolean NOT NULL DEFAULT false,     -- รับไฟจาก PoE ของ uplink
  mgmt_ip                inet,
  mac                    macaddr,
  firmware_version       text,
  mgmt_protocols         text[] NOT NULL DEFAULT '{}',       -- {ssh,https,snmpv3,winbox}
  secret_ref             text,                               -- ชี้ไปที่เก็บ secret ภายนอก ไม่เก็บรหัสจริง
  lifecycle              text NOT NULL DEFAULT 'active',     -- planned, active, spare, retired
  data_status            text NOT NULL DEFAULT 'unverified',
  verified_at            timestamptz,
  verified_by            uuid REFERENCES core.staff(id),
  attributes             jsonb NOT NULL DEFAULT '{}',
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  row_version            integer NOT NULL DEFAULT 1,
  deleted_at             timestamptz,
  CHECK (location_id IS NOT NULL OR floor_id IS NOT NULL OR role_code IN ('wan','controller')),
  CHECK (managed_by_device_id IS NULL OR managed_by_device_id <> id)
);
CREATE UNIQUE INDEX devices_mgmt_ip_uq ON net.devices (mgmt_ip) WHERE mgmt_ip IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX devices_name_trgm ON net.devices USING gin (display_name gin_trgm_ops);
CREATE INDEX devices_managed_by ON net.devices (managed_by_device_id);
ALTER TABLE net.subnets ADD CONSTRAINT subnets_dhcp_fk FOREIGN KEY (dhcp_server_device_id) REFERENCES net.devices(id);

CREATE TABLE net.device_vlans (
  device_id uuid NOT NULL REFERENCES net.devices(id) ON DELETE CASCADE,
  vlan_id   integer NOT NULL REFERENCES net.vlans(id),
  PRIMARY KEY (device_id, vlan_id)
);

CREATE TABLE net.interfaces (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id       uuid NOT NULL REFERENCES net.devices(id) ON DELETE CASCADE,
  name            text NOT NULL,               -- sfp-sfpplus1, ether5, pppoe-3bb, bond1, port 12
  kind            text NOT NULL,               -- copper, sfp, bond, pppoe, wireless, virtual, patch
  speed_mbps      integer,
  poe             boolean NOT NULL DEFAULT false,
  mac             macaddr,
  description     text,
  zabbix_itemkey  text,
  UNIQUE (device_id, name)
);

CREATE TABLE net.transceivers (                -- SFP/SFP+ ที่เสียบอยู่
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  interface_id  uuid UNIQUE REFERENCES net.interfaces(id) ON DELETE SET NULL,
  model_id      integer REFERENCES catalog.models(id),
  form_factor   text,                          -- SFP, SFP+, SFP28, QSFP+
  standard      text,                          -- 1000BASE-LX, 10GBASE-LR, BiDi
  wavelength_nm smallint,
  fiber_mode    text,                          -- sm, mm
  serial_no     text,
  status        text NOT NULL DEFAULT 'installed'   -- installed, spare, faulty
);

CREATE TABLE net.interface_vlans (             -- VLAN ต่อพอร์ต (access / tagged / native)
  interface_id uuid NOT NULL REFERENCES net.interfaces(id) ON DELETE CASCADE,
  vlan_id      integer NOT NULL REFERENCES net.vlans(id),
  mode         text NOT NULL CHECK (mode IN ('access','tagged','native')),
  PRIMARY KEY (interface_id, vlan_id)
);

CREATE TABLE net.ip_addresses (
  id            serial PRIMARY KEY,
  address       inet NOT NULL UNIQUE,
  subnet_id     integer REFERENCES net.subnets(id),
  interface_id  uuid REFERENCES net.interfaces(id) ON DELETE SET NULL,
  device_id     uuid REFERENCES net.devices(id) ON DELETE SET NULL,
  asset_id      uuid REFERENCES asset.assets(id) ON DELETE SET NULL,   -- IP ของเครื่องปลายทาง (PC, printer) ในอนาคต
  role          text NOT NULL DEFAULT 'primary',
  reserved      boolean NOT NULL DEFAULT false
);

CREATE TABLE net.link_media (code text PRIMARY KEY, name text NOT NULL);

CREATE TABLE net.cables (                      -- สายจริงหนึ่งเส้น (ไฟเบอร์หลายแกน หรือสาย LAN)
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code              text NOT NULL UNIQUE,      -- FO-B2-BA-01 (ตรงป้ายที่สาย)
  kind              text NOT NULL,             -- fiber_sm, fiber_mm, cat6, cat6a, cat5e
  core_count        smallint,                  -- จำนวนแกน (ไฟเบอร์)
  length_m          integer,
  a_location_id     uuid REFERENCES core.locations(id),
  b_location_id     uuid REFERENCES core.locations(id),
  route_note        text,                      -- เส้นทางจริง เช่น ท่อใต้ดินหน้าอาคาร 8 เซียน
  installed_at      date,
  installer_org_id  uuid REFERENCES core.organizations(id),
  status            text NOT NULL DEFAULT 'in_use',   -- planned, in_use, damaged, abandoned
  attributes        jsonb NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  row_version       integer NOT NULL DEFAULT 1,
  deleted_at        timestamptz
);

CREATE TABLE net.cable_cores (                 -- แต่ละแกนของไฟเบอร์ ใช้/ว่าง/เสีย ต่อพอร์ตไหน
  cable_id        uuid NOT NULL REFERENCES net.cables(id) ON DELETE CASCADE,
  core_no         smallint NOT NULL,
  color           text,                        -- สีแกนตามมาตรฐาน
  status          text NOT NULL DEFAULT 'spare',   -- used, spare, broken
  a_interface_id  uuid REFERENCES net.interfaces(id) ON DELETE SET NULL,   -- พอร์ต ODF/สวิตช์ ฝั่ง a
  b_interface_id  uuid REFERENCES net.interfaces(id) ON DELETE SET NULL,
  loss_db         numeric(5,2),                -- ค่าสูญเสียที่วัดได้ล่าสุด
  tested_at       date,
  PRIMARY KEY (cable_id, core_no)
);

CREATE TABLE net.link_groups (                 -- LACP / bond หลายเส้นรวมเป็นหนึ่ง
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text NOT NULL UNIQUE,           -- lacp-c2116-c1036
  kind         text NOT NULL DEFAULT 'lacp',
  a_device_id  uuid NOT NULL REFERENCES net.devices(id),
  b_device_id  uuid NOT NULL REFERENCES net.devices(id)
);

CREATE TABLE net.links (                       -- การเชื่อมทางลอจิคัลระหว่างอุปกรณ์ (ต้นไม้ uplink)
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text UNIQUE,
  a_device_id     uuid NOT NULL REFERENCES net.devices(id),   -- upstream
  a_interface_id  uuid REFERENCES net.interfaces(id),
  b_device_id     uuid NOT NULL REFERENCES net.devices(id),   -- downstream
  b_interface_id  uuid REFERENCES net.interfaces(id),
  media_code      text NOT NULL REFERENCES net.link_media(code),
  is_uplink       boolean NOT NULL DEFAULT true,
  group_id        uuid REFERENCES net.link_groups(id),
  cable_id        uuid REFERENCES net.cables(id),
  cable_cores     smallint[],                  -- แกนที่ใช้ เช่น {1,2}
  speed_mbps      integer,
  attributes      jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  row_version     integer NOT NULL DEFAULT 1,
  deleted_at      timestamptz,
  CHECK (a_device_id <> b_device_id)
);
CREATE UNIQUE INDEX links_one_uplink ON net.links (b_device_id) WHERE is_uplink AND deleted_at IS NULL;

CREATE TABLE net.outlets (                     -- จุด LAN ที่ผนัง/เพดาน: ห้องไหน → patch panel พอร์ตไหน → สวิตช์พอร์ตไหน
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                 text NOT NULL UNIQUE,   -- ป้ายหน้าจุด เช่น B2-3-2310-05
  location_id          uuid NOT NULL REFERENCES core.locations(id),
  purpose              text,                   -- pc, ap, cctv, printer, spare
  patch_interface_id   uuid REFERENCES net.interfaces(id),   -- พอร์ตบน patch panel (patch panel เป็น device role patch_panel)
  switch_interface_id  uuid REFERENCES net.interfaces(id),   -- พอร์ตสวิตช์ที่ patch ไว้
  status               text NOT NULL DEFAULT 'active',       -- active, dead, spare
  verified_at          timestamptz
);

CREATE TABLE net.wan_circuits (
  id                   serial PRIMARY KEY,
  device_id            uuid NOT NULL UNIQUE REFERENCES net.devices(id),
  provider_org_id      uuid NOT NULL REFERENCES core.organizations(id),
  circuit_ref          text,
  priority             smallint NOT NULL,      -- 1 หลัก ... 4 สำรองสุดท้าย
  bandwidth_down_mbps  integer,
  bandwidth_up_mbps    integer,
  public_ips           inet[],
  contract_no          text,
  contract_start       date,
  contract_end         date,
  monthly_cost         numeric(12,2),
  sla_text             text,                   -- เงื่อนไข SLA ตามสัญญา
  router_interface_id  uuid REFERENCES net.interfaces(id),
  notes                text
);

CREATE TABLE net.ssids (
  id                    serial PRIMARY KEY,
  name                  text NOT NULL,
  controller_device_id  uuid REFERENCES net.devices(id),
  vlan_id               integer REFERENCES net.vlans(id),
  bands                 text[] NOT NULL DEFAULT '{}',   -- {2.4,5,6}
  security              text,                           -- wpa2-psk, wpa3, 802.1x, open-portal
  audience              text,                           -- staff, student, guest, iot
  active                boolean NOT NULL DEFAULT true,
  UNIQUE (controller_device_id, name)
);

-- ================= viz =================
CREATE TABLE viz.building_shapes (
  building_id  uuid PRIMARY KEY REFERENCES core.buildings(id) ON DELETE CASCADE,
  x numeric NOT NULL, z numeric NOT NULL, width numeric NOT NULL, depth numeric NOT NULL,
  rotation numeric NOT NULL DEFAULT 0, floor_height numeric NOT NULL DEFAULT 0.9,
  shape jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE viz.area_shapes (
  id serial PRIMARY KEY, site_id uuid NOT NULL REFERENCES core.sites(id),
  code text NOT NULL, name text NOT NULL, kind text NOT NULL,
  x numeric NOT NULL, z numeric NOT NULL, width numeric NOT NULL, depth numeric NOT NULL, rotation numeric NOT NULL DEFAULT 0,
  UNIQUE (site_id, code)
);
CREATE TABLE viz.location_placements (          -- ตำแหน่งห้องในผัง (แผ่นห้องคอมฯ, ไฮไลต์ห้อง)
  location_id uuid PRIMARY KEY REFERENCES core.locations(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'auto',            -- auto (จาก corridor_order + side), manual
  u numeric, v numeric, span_u numeric, span_v numeric
);
CREATE TABLE viz.device_placements (
  device_id uuid PRIMARY KEY REFERENCES net.devices(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'auto', u numeric, v numeric, height_offset numeric NOT NULL DEFAULT 0
);
CREATE TABLE viz.link_routes (
  link_id uuid PRIMARY KEY REFERENCES net.links(id) ON DELETE CASCADE,
  color text, lane smallint, waypoints jsonb NOT NULL DEFAULT '[]', rule text
);
CREATE TABLE viz.view_presets (
  id serial PRIMARY KEY, name text NOT NULL UNIQUE, camera jsonb NOT NULL,
  created_by uuid REFERENCES core.staff(id)
);
CREATE TABLE viz.displays (                     -- จอทีวีแต่ละจอ
  id             serial PRIMARY KEY,
  code           text NOT NULL UNIQUE,          -- tv-it-room, tv-server
  name           text NOT NULL,
  location_id    uuid REFERENCES core.locations(id),
  preset_id      integer REFERENCES viz.view_presets(id),
  cycle_seconds  smallint NOT NULL DEFAULT 10,
  sound          boolean NOT NULL DEFAULT true,
  eco_mode       text NOT NULL DEFAULT 'auto',  -- auto, on, off
  layers         jsonb NOT NULL DEFAULT '{}',   -- ชั้นข้อมูลที่เปิด
  display_token_hash text,                      -- จอเปิดแบบไม่ต้องล็อกอินด้วย token เฉพาะจอ (อ่านอย่างเดียว)
  last_seen_at   timestamptz
);

-- ================= auth =================
CREATE TABLE auth.roles (code text PRIMARY KEY, name text NOT NULL);
CREATE TABLE auth.users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  staff_id      uuid REFERENCES core.staff(id),
  active        boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE auth.user_roles (
  user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_code text NOT NULL REFERENCES auth.roles(code),
  scope_building_id uuid REFERENCES core.buildings(id),   -- NULL = ทุกอาคาร (เผื่อมอบสิทธิ์รายอาคาร)
  PRIMARY KEY (user_id, role_code)
);
CREATE TABLE auth.user_prefs (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  prefs      jsonb NOT NULL DEFAULT '{}',       -- eco, recent_searches, tour_done, theme, default_preset
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE auth.api_clients (                 -- ระบบอื่นที่เรียก API (n8n, SBC Portal, GLPI)
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL UNIQUE,
  token_hash    text NOT NULL,                  -- เก็บเฉพาะ hash
  scopes        text[] NOT NULL DEFAULT '{}',   -- read:registry, read:status, write:ack
  created_by    uuid REFERENCES auth.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,
  expires_at    timestamptz,
  revoked_at    timestamptz
);

-- ================= ops =================
CREATE TABLE ops.incidents (                    -- ประวัติเหตุระยะยาว (Zabbix ลบประวัติตามรอบ; ที่นี่เก็บสรุปถาวร)
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zabbix_eventid    text UNIQUE,
  device_id         uuid REFERENCES net.devices(id),
  root_device_id    uuid REFERENCES net.devices(id),     -- ต้นเหตุ
  severity          text NOT NULL,                       -- down, warn
  summary           text NOT NULL,
  started_at        timestamptz NOT NULL,
  ended_at          timestamptz,
  affected_count    integer NOT NULL DEFAULT 0,
  acked_at          timestamptz,
  acked_by          uuid REFERENCES core.staff(id),
  ack_note          text,
  cause_code        text,                                -- power, fiber_cut, hardware, config, isp, planned, unknown
  resolution        text,
  glpi_ticket_id    text,
  in_school_hours   boolean                              -- เกิดในเวลาเรียนหรือไม่ (ใช้รายงาน)
);
CREATE INDEX incidents_time ON ops.incidents (started_at DESC);

CREATE TABLE ops.changes (                      -- งานเปลี่ยนแปลง/งานบำรุงรักษาที่วางแผน
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                   text NOT NULL UNIQUE,  -- CHG-2026-001
  title                  text NOT NULL,
  description            text,
  risk                   text NOT NULL DEFAULT 'low',   -- low, medium, high
  status                 text NOT NULL DEFAULT 'draft', -- draft, approved, in_progress, done, cancelled, rolled_back
  planned_start          timestamptz,
  planned_end            timestamptz,
  actual_start           timestamptz,
  actual_end             timestamptz,
  requested_by           uuid REFERENCES core.staff(id),
  approved_by            uuid REFERENCES core.staff(id),
  zabbix_maintenanceid   text,                  -- สร้าง maintenance ใน Zabbix ให้อัตโนมัติ
  glpi_ticket_id         text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  row_version            integer NOT NULL DEFAULT 1
);
CREATE TABLE ops.change_items (
  change_id    uuid NOT NULL REFERENCES ops.changes(id) ON DELETE CASCADE,
  entity_table text NOT NULL,
  entity_id    uuid NOT NULL,
  PRIMARY KEY (change_id, entity_table, entity_id)
);

CREATE TABLE ops.oncall_shifts (
  id         serial PRIMARY KEY,
  staff_id   uuid NOT NULL REFERENCES core.staff(id),
  starts_at  timestamptz NOT NULL,
  ends_at    timestamptz NOT NULL,
  role       text NOT NULL DEFAULT 'primary',   -- primary, backup
  CHECK (ends_at > starts_at)
);

CREATE TABLE ops.notify_channels (
  id          serial PRIMARY KEY,
  name        text NOT NULL UNIQUE,             -- LINE ทีมไอที, Telegram NOC
  kind        text NOT NULL,                    -- line, telegram, email, webhook
  target_ref  text NOT NULL,                    -- ชี้ไปที่ secret/ค่าใน n8n ไม่เก็บ token จริง
  active      boolean NOT NULL DEFAULT true
);
CREATE TABLE ops.notify_rules (
  id                  serial PRIMARY KEY,
  channel_id          integer NOT NULL REFERENCES ops.notify_channels(id) ON DELETE CASCADE,
  min_severity        text NOT NULL DEFAULT 'down',
  building_id         uuid REFERENCES core.buildings(id),    -- NULL = ทุกอาคาร
  role_code           text REFERENCES catalog.device_roles(code),
  only_unacked        boolean NOT NULL DEFAULT true,
  delay_minutes       smallint NOT NULL DEFAULT 0,           -- รอให้หายเองก่อนแจ้ง
  escalate_minutes    smallint,                               -- ไม่มีคนรับภายในเวลานี้ แจ้งเวรสำรอง
  school_hours_only   boolean NOT NULL DEFAULT false,
  active              boolean NOT NULL DEFAULT true
);

CREATE TABLE ops.runbooks (                      -- คู่มือแก้ปัญหา ผูกกับบทบาท/รุ่น/อุปกรณ์
  id          serial PRIMARY KEY,
  title       text NOT NULL,
  url         text NOT NULL,
  role_code   text REFERENCES catalog.device_roles(code),
  model_id    integer REFERENCES catalog.models(id),
  device_id   uuid REFERENCES net.devices(id),
  cause_code  text
);

CREATE TABLE ops.availability_monthly (          -- ความพร้อมใช้รายเดือน (สรุปจาก Zabbix เก็บถาวร)
  device_id        uuid NOT NULL REFERENCES net.devices(id) ON DELETE CASCADE,
  month            date NOT NULL,                -- วันที่ 1 ของเดือน
  uptime_pct       numeric(6,3) NOT NULL,
  downtime_minutes integer NOT NULL DEFAULT 0,
  incident_count   integer NOT NULL DEFAULT 0,
  school_hours_uptime_pct numeric(6,3),
  PRIMARY KEY (device_id, month)
);

-- ================= sync =================
CREATE TABLE sync.runs (
  id bigserial PRIMARY KEY,
  system_code text NOT NULL REFERENCES core.source_systems(code),
  job text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
  status text NOT NULL DEFAULT 'running',
  created_n integer NOT NULL DEFAULT 0, updated_n integer NOT NULL DEFAULT 0, error_n integer NOT NULL DEFAULT 0,
  detail jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE sync.issues (
  id bigserial PRIMARY KEY,
  run_id bigint REFERENCES sync.runs(id) ON DELETE SET NULL,
  system_code text NOT NULL REFERENCES core.source_systems(code),
  kind text NOT NULL,                 -- unmatched_host, ip_conflict, loc_conflict, missing_uplink, topology_mismatch, warranty_expiring, eol_model
  external_id text, entity_table text, entity_id uuid,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz, resolved_by uuid REFERENCES auth.users(id)
);
CREATE TABLE sync.discovered_neighbors (       -- เพื่อนบ้านจาก LLDP/CDP/MNDP ใช้ตรวจว่าทะเบียนสายตรงของจริง
  device_id        uuid NOT NULL REFERENCES net.devices(id) ON DELETE CASCADE,
  local_interface  text NOT NULL,
  remote_sysname   text,
  remote_port      text,
  remote_mac       macaddr,
  remote_ip        inet,
  protocol         text,                        -- lldp, cdp, mndp
  seen_at          timestamptz NOT NULL DEFAULT now(),
  matched_link_id  uuid REFERENCES net.links(id) ON DELETE SET NULL,
  PRIMARY KEY (device_id, local_interface, protocol)
);

-- ================= audit =================
CREATE TABLE audit.change_log (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL DEFAULT coalesce(current_setting('app.actor', true), current_user),
  table_name text NOT NULL, row_id text NOT NULL, op text NOT NULL,
  before jsonb, after jsonb
);
CREATE INDEX change_log_row ON audit.change_log (table_name, row_id, at DESC);

CREATE TABLE audit.user_actions (               -- การกระทำในหน้าจอ: รับเรื่อง, ยกเลิก, สร้าง maintenance, ออก token
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  user_id uuid REFERENCES auth.users(id),
  api_client_id uuid REFERENCES auth.api_clients(id),
  action text NOT NULL,
  target text,
  detail jsonb NOT NULL DEFAULT '{}',
  source_ip inet
);
CREATE INDEX user_actions_time ON audit.user_actions (at DESC);

CREATE OR REPLACE FUNCTION audit.log_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO audit.change_log(table_name,row_id,op,before,after)
  VALUES (TG_TABLE_SCHEMA||'.'||TG_TABLE_NAME,
          coalesce(to_jsonb(NEW)->>'id', to_jsonb(OLD)->>'id',
                   to_jsonb(NEW)->>'device_id', to_jsonb(OLD)->>'device_id',
                   to_jsonb(NEW)->>'location_id', to_jsonb(OLD)->>'location_id',
                   to_jsonb(NEW)->>'link_id', to_jsonb(OLD)->>'link_id',
                   to_jsonb(NEW)->>'cable_id', to_jsonb(OLD)->>'cable_id',
                   to_jsonb(NEW)->>'user_id', to_jsonb(OLD)->>'user_id',
                   to_jsonb(NEW)->>'interface_id', to_jsonb(OLD)->>'interface_id',
                   to_jsonb(NEW)->>'code', to_jsonb(OLD)->>'code', '?'),
          TG_OP,
          CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END,
          CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END);
  RETURN coalesce(NEW, OLD);
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'core.organizations','core.contacts','core.staff','core.sites','core.buildings','core.locations','core.attachments',
    'asset.assets','net.racks','net.devices','net.interfaces','net.transceivers','net.interface_vlans','net.cables','net.cable_cores',
    'net.link_groups','net.links','net.outlets','net.vlans','net.subnets','net.wan_circuits','net.ssids',
    'viz.location_placements','viz.device_placements','viz.link_routes','viz.displays',
    'auth.user_roles','auth.api_clients','ops.changes','ops.notify_rules','ops.notify_channels','ops.oncall_shifts']
  LOOP
    EXECUTE format('CREATE TRIGGER audit_%s AFTER INSERT OR UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION audit.log_change()',
                   replace(t,'.','_'), t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY[
    'core.organizations','core.staff','core.sites','core.buildings','core.locations','asset.assets',
    'net.racks','net.devices','net.cables','net.links','ops.changes']
  LOOP
    EXECUTE format('CREATE TRIGGER touch_%s BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION core.touch_row()',
                   replace(t,'.','_'), t);
  END LOOP;
END $$;

-- ================= api (สัญญาข้อมูลสำหรับระบบอื่น) =================
CREATE VIEW api.v_locations AS
SELECT l.loc_code, l.room_number, b.code AS building_code, b.name AS building_name, f.level AS floor,
       l.name, l.type_code, l.corridor_order, l.side, l.has_rack, l.owner_system, l.verified_at
FROM core.locations l JOIN core.floors f ON f.id = l.floor_id JOIN core.buildings b ON b.id = f.building_id
WHERE l.deleted_at IS NULL;

CREATE VIEW api.v_devices AS
SELECT d.code, d.display_name, d.hostname, d.role_code, r.layer, m.name AS model, d.mgmt_ip, d.firmware_version,
       b.code AS building_code, coalesce(f.level, lf.level) AS floor, l.loc_code, rk.code AS rack_code, d.rack_u_start,
       up.code AS uplink_code, lk.media_code AS uplink_media, mg.code AS managed_by_code, ps.code AS power_source_code,
       zx.external_id AS zabbix_hostid, gl.external_id AS glpi_id, a.asset_tag, a.warranty_until, m.eol_date,
       d.lifecycle, d.data_status, d.verified_at
FROM net.devices d
JOIN catalog.device_roles r ON r.code = d.role_code
LEFT JOIN catalog.models m ON m.id = d.model_id
LEFT JOIN core.locations l ON l.id = d.location_id
LEFT JOIN core.floors lf ON lf.id = l.floor_id
LEFT JOIN core.floors f ON f.id = d.floor_id
LEFT JOIN core.buildings b ON b.id = coalesce(f.building_id, lf.building_id)
LEFT JOIN net.racks rk ON rk.id = d.rack_id
LEFT JOIN net.links lk ON lk.b_device_id = d.id AND lk.is_uplink AND lk.deleted_at IS NULL
LEFT JOIN net.devices up ON up.id = lk.a_device_id
LEFT JOIN net.devices mg ON mg.id = d.managed_by_device_id
LEFT JOIN net.devices ps ON ps.id = d.power_source_device_id
LEFT JOIN asset.assets a ON a.id = d.asset_id
LEFT JOIN core.external_refs zx ON zx.entity_table='net.devices' AND zx.entity_id=d.id AND zx.system_code='zabbix'
LEFT JOIN core.external_refs gl ON gl.entity_table='net.devices' AND gl.entity_id=d.id AND gl.system_code='glpi'
WHERE d.deleted_at IS NULL;

CREATE VIEW api.v_fiber_cores AS
SELECT c.code AS cable_code, c.kind, c.core_count, cc.core_no, cc.color, cc.status, cc.loss_db, cc.tested_at,
       da.code AS a_device, ia.name AS a_port, db.code AS b_device, ib.name AS b_port
FROM net.cables c JOIN net.cable_cores cc ON cc.cable_id = c.id
LEFT JOIN net.interfaces ia ON ia.id = cc.a_interface_id LEFT JOIN net.devices da ON da.id = ia.device_id
LEFT JOIN net.interfaces ib ON ib.id = cc.b_interface_id LEFT JOIN net.devices db ON db.id = ib.device_id
WHERE c.deleted_at IS NULL AND c.kind LIKE 'fiber%';

CREATE VIEW api.v_outlets AS
SELECT o.code, l.loc_code, l.name AS location_name, o.purpose, o.status,
       sd.code AS switch_code, si.name AS switch_port, o.verified_at
FROM net.outlets o JOIN core.locations l ON l.id = o.location_id
LEFT JOIN net.interfaces si ON si.id = o.switch_interface_id LEFT JOIN net.devices sd ON sd.id = si.device_id;

CREATE VIEW api.v_incidents AS
SELECT i.started_at, i.ended_at, i.severity, i.summary, d.code AS device_code, rd.code AS root_device_code,
       i.affected_count, s.staff_code AS acked_by, i.cause_code, i.in_school_hours, i.glpi_ticket_id
FROM ops.incidents i
LEFT JOIN net.devices d ON d.id = i.device_id LEFT JOIN net.devices rd ON rd.id = i.root_device_id
LEFT JOIN core.staff s ON s.id = i.acked_by;

-- ================= สิทธิ์ =================
-- noc_migrate: เจ้าของ schema ใช้ตอน migration
-- noc_app:     api/worker อ่านเขียนตาราง ไม่มี DDL
-- noc_read:    Metabase / Grafana / ระบบอื่น อ่านเฉพาะ schema api
-- สร้าง role/GRANT ใน migration แยก รหัสผ่านอยู่ใน secret ของ compose/Gitea

-- ================= นโยบายเก็บข้อมูล (ตั้งเป็นงานตั้งเวลาใน worker) =================
-- audit.change_log เก็บ 3 ปี, audit.user_actions เก็บ 1 ปี, sync.runs เก็บ 90 วัน,
-- sync.discovered_neighbors เก็บเฉพาะที่เห็นใน 30 วันล่าสุด, ops.incidents และ ops.availability_monthly เก็บถาวร

-- ================= ค่าตั้งต้น lookup =================
INSERT INTO core.source_systems(code,name) VALUES
 ('noc','SBC NOC'),('zabbix','Zabbix 7.0'),('glpi','GLPI'),('sbc_asset','SBC ASSET'),('sbc_portal','SBC Portal'),
 ('unifi','UniFi controller'),('omada','Omada controller'),('link_ap','LINK AP controller'),
 ('gsheet_seed','Google Sheet ตั้งต้น'),('lldp','LLDP/CDP/MNDP discovery');
INSERT INTO core.building_forms VALUES ('single_loaded','ห้องแถวเดียวมีทางเดิน'),('double_loaded','ห้องสองฝั่งทางเดินกลาง'),
 ('courtyard','ล้อมลานกลาง'),('hall','โถง/โดม'),('open_area','พื้นที่โล่ง');
INSERT INTO core.location_types VALUES ('classroom','ห้องเรียน'),('computer_lab','ห้องคอมพิวเตอร์'),('office','สำนักงาน'),
 ('staff_room','ห้องพักครู'),('server_room','ห้อง server'),('rack_closet','ตู้/ห้อง rack'),('library','ห้องสมุด'),
 ('hall','หอประชุม/โถง'),('storage','คลัง/เก็บของ'),('shop','ร้านค้า'),('corridor','ทางเดิน/โถงบันได'),('outdoor','ภายนอกอาคาร'),('other','อื่นๆ');
INSERT INTO catalog.device_roles(code,name,layer,monitored) VALUES
 ('core','อุปกรณ์แกนกลาง','net',true),('main','main อาคาร','net',true),('access','สวิตช์ประจำชั้น','net',true),
 ('fiber_point','จุดรับไฟเบอร์','net',true),('finance_router','เราเตอร์การเงิน','net',true),('media_converter','media converter','net',true),
 ('ap','Access Point','ap',true),('nvr','NVR','nvr',true),('camera','กล้องวงจรปิด','nvr',false),
 ('wan','อินเทอร์เน็ต (ISP)','wan',true),('controller','controller','planned',true),
 ('ups','UPS','power',true),('pdu','PDU','power',false),('patch_panel','patch panel','passive',false),('odf','ODF ไฟเบอร์','passive',false),
 ('server','server','net',true),('printer','เครื่องพิมพ์','endpoint',false);
INSERT INTO net.link_media VALUES ('fiber','ไฟเบอร์'),('copper','สาย LAN'),('lacp','LACP'),('trunk','VLAN trunk'),
 ('pppoe','PPPoE'),('wireless','ไร้สาย'),('planned','วางแผน'),('patch','สาย patch');
INSERT INTO auth.roles VALUES ('viewer','ดูอย่างเดียว'),('operator','รับเรื่องได้'),('registry_admin','ผู้ดูแลทะเบียน'),
 ('change_manager','อนุมัติงานเปลี่ยนแปลง'),('admin','ผู้ดูแลระบบ');
