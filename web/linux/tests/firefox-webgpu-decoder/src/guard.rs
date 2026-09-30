//! Panic-free ID validation for untrusted bincode input.
//!
//! wgpu-core deserializes every `Id<T>` as `SerialId::Id(index, epoch,
//! backend)` and converts it with `RawId::zip`, which panics on an epoch of
//! 2^29 or more and on the all-zero id. Serializing an id with backend
//! `BrowserWebGpu` (5) later hits `unreachable!` in `RawId::backend`. With
//! panic=abort on wasm32 any of these would trap the instance.
//!
//! `Guard` wraps a `Deserializer` and forwards every call unchanged, except
//! `deserialize_enum("SerialId", ["Id"], ..)`. There it reads the same wire
//! layout (u32 variant, u32 index, u32 epoch, Backend as u32 variant),
//! validates it, and replays the checked values to the original visitor.
//! All nested data (options, sequences, maps, enums, newtypes) goes through
//! the same guard, so every id at any depth is checked before `zip` runs.

use serde::de::{
    self, value::SeqDeserializer, value::U32Deserializer, DeserializeSeed, Deserializer,
    EnumAccess, Error as _, MapAccess, SeqAccess, VariantAccess, Visitor,
};
use std::fmt;
use std::marker::PhantomData;

const EPOCH_BITS: u32 = 29;

pub struct Guard<D>(pub D);
pub struct GuardVisitor<V>(pub V);
pub struct GuardSeed<S>(pub S);
struct GuardSeq<A>(A);
struct GuardMap<A>(A);
struct GuardEnum<A>(A);
struct GuardVariant<A>(A);

/// Root seed: deserialize `T` through the guard.
pub struct Root<T>(pub PhantomData<T>);

impl<'de, T: de::Deserialize<'de>> DeserializeSeed<'de> for Root<T> {
    type Value = T;
    fn deserialize<D: Deserializer<'de>>(self, d: D) -> Result<T, D::Error> {
        T::deserialize(Guard(d))
    }
}

impl<'de, S: DeserializeSeed<'de>> DeserializeSeed<'de> for GuardSeed<S> {
    type Value = S::Value;
    fn deserialize<D: Deserializer<'de>>(self, d: D) -> Result<S::Value, D::Error> {
        self.0.deserialize(Guard(d))
    }
}

macro_rules! fwd {
    ($($m:ident),*) => {$(
        fn $m<V: Visitor<'de>>(self, v: V) -> Result<V::Value, Self::Error> {
            self.0.$m(GuardVisitor(v))
        }
    )*};
}

impl<'de, D: Deserializer<'de>> Deserializer<'de> for Guard<D> {
    type Error = D::Error;
    fwd!(
        deserialize_any, deserialize_bool, deserialize_i8, deserialize_i16, deserialize_i32,
        deserialize_i64, deserialize_i128, deserialize_u8, deserialize_u16, deserialize_u32,
        deserialize_u64, deserialize_u128, deserialize_f32, deserialize_f64, deserialize_char,
        deserialize_str, deserialize_string, deserialize_bytes, deserialize_byte_buf,
        deserialize_option, deserialize_unit, deserialize_seq, deserialize_map,
        deserialize_identifier, deserialize_ignored_any
    );
    fn deserialize_unit_struct<V: Visitor<'de>>(self, n: &'static str, v: V) -> Result<V::Value, D::Error> {
        self.0.deserialize_unit_struct(n, GuardVisitor(v))
    }
    fn deserialize_newtype_struct<V: Visitor<'de>>(self, n: &'static str, v: V) -> Result<V::Value, D::Error> {
        self.0.deserialize_newtype_struct(n, GuardVisitor(v))
    }
    fn deserialize_tuple<V: Visitor<'de>>(self, len: usize, v: V) -> Result<V::Value, D::Error> {
        self.0.deserialize_tuple(len, GuardVisitor(v))
    }
    fn deserialize_tuple_struct<V: Visitor<'de>>(self, n: &'static str, len: usize, v: V) -> Result<V::Value, D::Error> {
        self.0.deserialize_tuple_struct(n, len, GuardVisitor(v))
    }
    fn deserialize_struct<V: Visitor<'de>>(
        self,
        n: &'static str,
        f: &'static [&'static str],
        v: V,
    ) -> Result<V::Value, D::Error> {
        self.0.deserialize_struct(n, f, GuardVisitor(v))
    }
    fn deserialize_enum<V: Visitor<'de>>(
        self,
        n: &'static str,
        variants: &'static [&'static str],
        v: V,
    ) -> Result<V::Value, D::Error> {
        if n == "SerialId" && variants == ["Id"] {
            let (index, epoch, backend) = self.0.deserialize_enum(n, variants, IdProbe)?;
            return v.visit_enum(CheckedId { index, epoch, backend, _e: PhantomData });
        }
        self.0.deserialize_enum(n, variants, GuardVisitor(v))
    }
    fn is_human_readable(&self) -> bool {
        self.0.is_human_readable()
    }
}

macro_rules! visit {
    ($($m:ident: $t:ty),*) => {$(
        fn $m<E: de::Error>(self, x: $t) -> Result<V::Value, E> { self.0.$m(x) }
    )*};
}

impl<'de, V: Visitor<'de>> Visitor<'de> for GuardVisitor<V> {
    type Value = V::Value;
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        self.0.expecting(f)
    }
    visit!(
        visit_bool: bool, visit_i8: i8, visit_i16: i16, visit_i32: i32, visit_i64: i64,
        visit_i128: i128, visit_u8: u8, visit_u16: u16, visit_u32: u32, visit_u64: u64,
        visit_u128: u128, visit_char: char,
        visit_str: &str, visit_borrowed_str: &'de str, visit_string: String,
        visit_bytes: &[u8], visit_borrowed_bytes: &'de [u8], visit_byte_buf: Vec<u8>
    );
    // WebGPU IDL floats are restricted (finite) and JSON cannot carry
    // NaN/Inf (serde_json would write null), so reject them here.
    fn visit_f32<E: de::Error>(self, x: f32) -> Result<V::Value, E> {
        if !x.is_finite() {
            return Err(E::custom("non-finite f32"));
        }
        self.0.visit_f32(x)
    }
    fn visit_f64<E: de::Error>(self, x: f64) -> Result<V::Value, E> {
        if !x.is_finite() {
            return Err(E::custom("non-finite f64"));
        }
        self.0.visit_f64(x)
    }
    fn visit_none<E: de::Error>(self) -> Result<V::Value, E> {
        self.0.visit_none()
    }
    fn visit_unit<E: de::Error>(self) -> Result<V::Value, E> {
        self.0.visit_unit()
    }
    fn visit_some<D: Deserializer<'de>>(self, d: D) -> Result<V::Value, D::Error> {
        self.0.visit_some(Guard(d))
    }
    fn visit_newtype_struct<D: Deserializer<'de>>(self, d: D) -> Result<V::Value, D::Error> {
        self.0.visit_newtype_struct(Guard(d))
    }
    fn visit_seq<A: SeqAccess<'de>>(self, a: A) -> Result<V::Value, A::Error> {
        self.0.visit_seq(GuardSeq(a))
    }
    fn visit_map<A: MapAccess<'de>>(self, a: A) -> Result<V::Value, A::Error> {
        self.0.visit_map(GuardMap(a))
    }
    fn visit_enum<A: EnumAccess<'de>>(self, a: A) -> Result<V::Value, A::Error> {
        self.0.visit_enum(GuardEnum(a))
    }
}

impl<'de, A: SeqAccess<'de>> SeqAccess<'de> for GuardSeq<A> {
    type Error = A::Error;
    fn next_element_seed<T: DeserializeSeed<'de>>(&mut self, s: T) -> Result<Option<T::Value>, A::Error> {
        self.0.next_element_seed(GuardSeed(s))
    }
    fn size_hint(&self) -> Option<usize> {
        self.0.size_hint()
    }
}

impl<'de, A: MapAccess<'de>> MapAccess<'de> for GuardMap<A> {
    type Error = A::Error;
    fn next_key_seed<K: DeserializeSeed<'de>>(&mut self, s: K) -> Result<Option<K::Value>, A::Error> {
        self.0.next_key_seed(GuardSeed(s))
    }
    fn next_value_seed<T: DeserializeSeed<'de>>(&mut self, s: T) -> Result<T::Value, A::Error> {
        self.0.next_value_seed(GuardSeed(s))
    }
    fn size_hint(&self) -> Option<usize> {
        self.0.size_hint()
    }
}

impl<'de, A: EnumAccess<'de>> EnumAccess<'de> for GuardEnum<A> {
    type Error = A::Error;
    type Variant = GuardVariant<A::Variant>;
    fn variant_seed<T: DeserializeSeed<'de>>(self, s: T) -> Result<(T::Value, Self::Variant), A::Error> {
        let (v, rest) = self.0.variant_seed(GuardSeed(s))?;
        Ok((v, GuardVariant(rest)))
    }
}

impl<'de, A: VariantAccess<'de>> VariantAccess<'de> for GuardVariant<A> {
    type Error = A::Error;
    fn unit_variant(self) -> Result<(), A::Error> {
        self.0.unit_variant()
    }
    fn newtype_variant_seed<T: DeserializeSeed<'de>>(self, s: T) -> Result<T::Value, A::Error> {
        self.0.newtype_variant_seed(GuardSeed(s))
    }
    fn tuple_variant<V: Visitor<'de>>(self, len: usize, v: V) -> Result<V::Value, A::Error> {
        self.0.tuple_variant(len, GuardVisitor(v))
    }
    fn struct_variant<V: Visitor<'de>>(self, f: &'static [&'static str], v: V) -> Result<V::Value, A::Error> {
        self.0.struct_variant(f, GuardVisitor(v))
    }
}

/// Reads the raw SerialId wire form and validates it.
struct IdProbe;

impl<'de> Visitor<'de> for IdProbe {
    type Value = (u32, u32, u32);
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("a wgpu-core SerialId")
    }
    fn visit_enum<A: EnumAccess<'de>>(self, a: A) -> Result<Self::Value, A::Error> {
        let (tag, rest): (u32, _) = a.variant()?;
        if tag != 0 {
            return Err(A::Error::custom(format_args!("SerialId: bad variant {tag}")));
        }
        rest.tuple_variant(3, IdFields)
    }
}

struct IdFields;

impl<'de> Visitor<'de> for IdFields {
    type Value = (u32, u32, u32);
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("SerialId fields (index, epoch, backend)")
    }
    fn visit_seq<A: SeqAccess<'de>>(self, mut s: A) -> Result<Self::Value, A::Error> {
        let short = || A::Error::custom("SerialId: truncated");
        let index: u32 = s.next_element()?.ok_or_else(short)?;
        let epoch: u32 = s.next_element()?.ok_or_else(short)?;
        let backend: RawBackend = s.next_element()?.ok_or_else(short)?;
        let backend = backend.0;
        if epoch >> EPOCH_BITS != 0 {
            return Err(A::Error::custom(format_args!("SerialId: epoch {epoch} >= 2^29")));
        }
        // 0..=4 are Empty, Vulkan, Metal, Dx12, Gl. 5 (BrowserWebGpu) is a
        // valid wgt::Backend but RawId::backend() cannot represent it.
        if backend > 4 {
            return Err(A::Error::custom(format_args!("SerialId: backend {backend} not representable")));
        }
        if index == 0 && epoch == 0 && backend == 0 {
            return Err(A::Error::custom("SerialId: zero id"));
        }
        Ok((index, epoch, backend))
    }
}

/// wgt::Backend's wire form: an enum variant index (u32).
struct RawBackend(u32);

impl<'de> de::Deserialize<'de> for RawBackend {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = RawBackend;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("a wgt::Backend")
            }
            fn visit_enum<A: EnumAccess<'de>>(self, a: A) -> Result<RawBackend, A::Error> {
                let (tag, rest): (u32, _) = a.variant()?;
                rest.unit_variant()?;
                Ok(RawBackend(tag))
            }
        }
        const VARIANTS: &[&str] = &["Empty", "Vulkan", "Metal", "Dx12", "Gl", "BrowserWebGpu"];
        d.deserialize_enum("Backend", VARIANTS, V)
    }
}

/// Replays a validated id to SerialId's derived visitor.
struct CheckedId<E> {
    index: u32,
    epoch: u32,
    backend: u32,
    _e: PhantomData<E>,
}

impl<'de, E: de::Error> EnumAccess<'de> for CheckedId<E> {
    type Error = E;
    type Variant = Self;
    fn variant_seed<T: DeserializeSeed<'de>>(self, s: T) -> Result<(T::Value, Self), E> {
        let v = s.deserialize(U32Deserializer::<E>::new(0))?;
        Ok((v, self))
    }
}

impl<'de, E: de::Error> VariantAccess<'de> for CheckedId<E> {
    type Error = E;
    fn unit_variant(self) -> Result<(), E> {
        Err(E::custom("SerialId: unexpected unit variant"))
    }
    fn newtype_variant_seed<T: DeserializeSeed<'de>>(self, _s: T) -> Result<T::Value, E> {
        Err(E::custom("SerialId: unexpected newtype variant"))
    }
    fn tuple_variant<V: Visitor<'de>>(self, _len: usize, v: V) -> Result<V::Value, E> {
        let mut seq = SeqDeserializer::<_, E>::new([self.index, self.epoch, self.backend].into_iter());
        let out = v.visit_seq(&mut seq)?;
        seq.end()?;
        Ok(out)
    }
    fn struct_variant<V: Visitor<'de>>(self, _f: &'static [&'static str], _v: V) -> Result<V::Value, E> {
        Err(E::custom("SerialId: unexpected struct variant"))
    }
}
