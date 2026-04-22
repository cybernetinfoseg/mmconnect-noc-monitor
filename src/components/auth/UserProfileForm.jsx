import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { UserCircle, Phone, MessageSquare, Loader, Globe } from 'lucide-react';
import { toast } from 'sonner';

const COUNTRIES = [
  { code: '+351', name: 'Portugal', flag: '🇵🇹' },
  { code: '+55', name: 'Brasil', flag: '🇧🇷' },
  { code: '+1', name: 'Estados Unidos', flag: '🇺🇸' },
  { code: '+44', name: 'Reino Unido', flag: '🇬🇧' },
  { code: '+33', name: 'França', flag: '🇫🇷' },
  { code: '+34', name: 'Espanha', flag: '🇪🇸' },
  { code: '+39', name: 'Itália', flag: '🇮🇹' },
  { code: '+49', name: 'Alemanha', flag: '🇩🇪' },
  { code: '+31', name: 'Holanda', flag: '🇳🇱' },
  { code: '+32', name: 'Bélgica', flag: '🇧🇪' },
  { code: '+43', name: 'Áustria', flag: '🇦🇹' },
  { code: '+41', name: 'Suíça', flag: '🇨🇭' },
  { code: '+46', name: 'Suécia', flag: '🇸🇪' },
  { code: '+47', name: 'Noruega', flag: '🇳🇴' },
  { code: '+45', name: 'Dinamarca', flag: '🇩🇰' },
  { code: '+358', name: 'Finlândia', flag: '🇫🇮' },
  { code: '+353', name: 'Irlanda', flag: '🇮🇪' },
  { code: '+30', name: 'Grécia', flag: '🇬🇷' },
  { code: '+48', name: 'Polônia', flag: '🇵🇱' },
  { code: '+36', name: 'Hungria', flag: '🇭🇺' },
  { code: '+420', name: 'República Tcheca', flag: '🇨🇿' },
  { code: '+40', name: 'Romênia', flag: '🇷🇴' },
  { code: '+355', name: 'Albânia', flag: '🇦🇱' },
  { code: '+212', name: 'Marrocos', flag: '🇲🇦' },
  { code: '+216', name: 'Tunísia', flag: '🇹🇳' },
  { code: '+20', name: 'Egito', flag: '🇪🇬' },
  { code: '+27', name: 'África do Sul', flag: '🇿🇦' },
  { code: '+234', name: 'Nigéria', flag: '🇳🇬' },
  { code: '+244', name: 'Angola', flag: '🇦🇴' },
  { code: '+258', name: 'Moçambique', flag: '🇲🇿' },
  { code: '+239', name: 'São Tomé e Príncipe', flag: '🇸🇹' },
  { code: '+856', name: 'Laos', flag: '🇱🇦' },
  { code: '+66', name: 'Tailândia', flag: '🇹🇭' },
  { code: '+60', name: 'Malásia', flag: '🇲🇾' },
  { code: '+65', name: 'Singapura', flag: '🇸🇬' },
  { code: '+62', name: 'Indonésia', flag: '🇮🇩' },
  { code: '+63', name: 'Filipinas', flag: '🇵🇭' },
  { code: '+81', name: 'Japão', flag: '🇯🇵' },
  { code: '+82', name: 'Coreia do Sul', flag: '🇰🇷' },
  { code: '+86', name: 'China', flag: '🇨🇳' },
  { code: '+91', name: 'Índia', flag: '🇮🇳' },
  { code: '+92', name: 'Paquistão', flag: '🇵🇰' },
  { code: '+880', name: 'Bangladesh', flag: '🇧🇩' },
  { code: '+94', name: 'Sri Lanka', flag: '🇱🇰' },
  { code: '+98', name: 'Irã', flag: '🇮🇷' },
  { code: '+971', name: 'Emirados Árabes Unidos', flag: '🇦🇪' },
  { code: '+966', name: 'Arábia Saudita', flag: '🇸🇦' },
  { code: '+972', name: 'Israel', flag: '🇮🇱' },
  { code: '+90', name: 'Turquia', flag: '🇹🇷' },
  { code: '+61', name: 'Austrália', flag: '🇦🇺' },
  { code: '+64', name: 'Nova Zelândia', flag: '🇳🇿' },
];

export default function UserProfileForm({ user, onSuccess, isEditMode = false }) {
  const [loading, setLoading] = useState(false);
   const [form, setForm] = useState({
     nome: user?.nome || '',
     sobrenome: user?.sobrenome || '',
     pais_telefone: user?.pais_telefone || '+351',
     telefone: user?.telefone || '',
     motivo_acesso: user?.motivo_acesso || '',
   });

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!form.nome.trim() || !form.sobrenome.trim() || !form.telefone.trim()) {
       toast.error('Preencha todos os campos obrigatórios');
       return;
     }

    setLoading(true);
    try {
      // Update user profile
       await base44.auth.updateMe({
         nome: form.nome.trim(),
         sobrenome: form.sobrenome.trim(),
         pais_telefone: form.pais_telefone,
         telefone: form.telefone.trim(),
         motivo_acesso: form.motivo_acesso.trim(),
         ...(isEditMode ? {} : { 
           primeiroAcesso: false,
           data_inscricao: new Date().toISOString(),
         }),
       });

      if (!isEditMode) {
        // Notify admin — fire-and-forget, não bloqueia o fluxo
        base44.functions.invoke('notifyAdminNewUser', {
           email: user.email,
           nome: form.nome.trim(),
           sobrenome: form.sobrenome.trim(),
           pais_telefone: form.pais_telefone,
           telefone: form.telefone.trim(),
           motivo_acesso: form.motivo_acesso.trim(),
           data_inscricao: new Date().toLocaleString('pt-PT'),
         }).catch(() => {});
      }

      toast.success(isEditMode ? 'Perfil atualizado com sucesso!' : 'Solicitação enviada! Aguarde a aprovação do admin.');
      onSuccess();
    } catch (error) {
      console.error('Erro:', error);
      toast.error('Erro ao salvar perfil. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="nome" className="text-slate-700 font-medium">
            <span className="flex items-center gap-2">
              <UserCircle className="h-4 w-4" />
              Primeiro Nome *
            </span>
          </Label>
          <Input
            id="nome"
            value={form.nome}
            onChange={(e) => setForm(prev => ({ ...prev, nome: e.target.value }))}
            placeholder="João"
            required
            className="border-slate-300"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="sobrenome" className="text-slate-700 font-medium">
            Sobrenome *
          </Label>
          <Input
            id="sobrenome"
            value={form.sobrenome}
            onChange={(e) => setForm(prev => ({ ...prev, sobrenome: e.target.value }))}
            placeholder="Silva"
            required
            className="border-slate-300"
          />
        </div>
      </div>



      <div className="space-y-2">
        <Label className="text-slate-700 font-medium">
          <span className="flex items-center gap-2">
            <Phone className="h-4 w-4" />
            Telefone de Contato *
          </span>
        </Label>
        <div className="flex gap-2">
            <div className="w-48 z-50">
              <Select value={form.pais_telefone} onValueChange={(value) => setForm(prev => ({ ...prev, pais_telefone: value }))}>
                <SelectTrigger className="border-slate-300 cursor-pointer">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-60 z-[9999]">
                  {COUNTRIES.map((country) => (
                    <SelectItem key={country.code} value={country.code} className="cursor-pointer">
                      {country.flag} {country.name} {country.code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Input
              id="telefone"
              value={form.telefone}
              onChange={(e) => setForm(prev => ({ ...prev, telefone: e.target.value }))}
              placeholder="923 456 789"
              required
              className="flex-1 border-slate-300"
            />
          </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="motivo" className="text-slate-700 font-medium">
          <span className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            Motivo para Solicitar Acesso
          </span>
        </Label>
        <Textarea
          id="motivo"
          value={form.motivo_acesso}
          onChange={(e) => setForm(prev => ({ ...prev, motivo_acesso: e.target.value }))}
          placeholder="Descreva brevemente por que precisa acessar o sistema..."
          rows={4}
          className="border-slate-300"
        />
      </div>

      <Button
        type="submit"
        disabled={loading}
        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium gap-2"
      >
        {loading ? (
          <>
            <Loader className="h-4 w-4 animate-spin" />
            Enviando...
          </>
        ) : (
          isEditMode ? 'Salvar Alterações' : 'Enviar Solicitação'
        )}
      </Button>
    </form>
  );
}