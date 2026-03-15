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
  { code: '+55', name: 'Brasil' },
  { code: '+1', name: 'Estados Unidos' },
  { code: '+44', name: 'Reino Unido' },
  { code: '+33', name: 'França' },
  { code: '+34', name: 'Espanha' },
  { code: '+39', name: 'Itália' },
  { code: '+49', name: 'Alemanha' },
  { code: '+31', name: 'Holanda' },
  { code: '+32', name: 'Bélgica' },
  { code: '+43', name: 'Áustria' },
  { code: '+41', name: 'Suíça' },
  { code: '+46', name: 'Suécia' },
  { code: '+47', name: 'Noruega' },
  { code: '+45', name: 'Dinamarca' },
  { code: '+358', name: 'Finlândia' },
  { code: '+353', name: 'Irlanda' },
  { code: '+351', name: 'Portugal' },
  { code: '+30', name: 'Grécia' },
  { code: '+48', name: 'Polônia' },
  { code: '+36', name: 'Hungria' },
  { code: '+420', name: 'República Tcheca' },
  { code: '+40', name: 'Romênia' },
  { code: '+355', name: 'Albânia' },
  { code: '+212', name: 'Marrocos' },
  { code: '+216', name: 'Tunísia' },
  { code: '+20', name: 'Egito' },
  { code: '+27', name: 'África do Sul' },
  { code: '+234', name: 'Nigéria' },
  { code: '+244', name: 'Angola' },
  { code: '+258', name: 'Moçambique' },
  { code: '+239', name: 'São Tomé e Príncipe' },
  { code: '+856', name: 'Laos' },
  { code: '+66', name: 'Tailândia' },
  { code: '+60', name: 'Malásia' },
  { code: '+65', name: 'Singapura' },
  { code: '+62', name: 'Indonésia' },
  { code: '+63', name: 'Filipinas' },
  { code: '+81', name: 'Japão' },
  { code: '+82', name: 'Coreia do Sul' },
  { code: '+86', name: 'China' },
  { code: '+91', name: 'Índia' },
  { code: '+92', name: 'Paquistão' },
  { code: '+880', name: 'Bangladesh' },
  { code: '+94', name: 'Sri Lanka' },
  { code: '+98', name: 'Irã' },
  { code: '+971', name: 'Emirados Árabes Unidos' },
  { code: '+966', name: 'Arábia Saudita' },
  { code: '+972', name: 'Israel' },
  { code: '+90', name: 'Turquia' },
  { code: '+61', name: 'Austrália' },
  { code: '+64', name: 'Nova Zelândia' },
];

export default function UserProfileForm({ user, onSuccess, isEditMode = false }) {
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    nome: user?.nome || '',
    sobrenome: user?.sobrenome || '',
    pais_telefone: user?.pais_telefone || '+55',
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
        // Notify admin about new user registration (only on first submission)
        await base44.functions.invoke('notifyAdminNewUser', {
          email: user.email,
          nome: form.nome.trim(),
          sobrenome: form.sobrenome.trim(),
          pais_telefone: form.pais_telefone,
          telefone: form.telefone.trim(),
          motivo_acesso: form.motivo_acesso.trim(),
          data_inscricao: new Date().toLocaleString('pt-BR'),
        });
      }

      toast.success(isEditMode ? 'Perfil atualizado com sucesso!' : 'Solicitação enviada! Aguarde a aprovação do admin.');
      onSuccess();
    } catch (error) {
      console.error('Erro:', error);
      toast.error('Erro ao salvar perfil');
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
          <div className="w-32">
            <Select value={form.pais_telefone} onValueChange={(value) => setForm(prev => ({ ...prev, pais_telefone: value }))}>
              <SelectTrigger className="border-slate-300">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-60">
                {COUNTRIES.map((country) => (
                  <SelectItem key={country.code} value={country.code}>
                    {country.name} {country.code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Input
            id="telefone"
            value={form.telefone}
            onChange={(e) => setForm(prev => ({ ...prev, telefone: e.target.value }))}
            placeholder="11 99999-9999"
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